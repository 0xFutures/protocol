pragma solidity ^0.4.23;
pragma experimental "v0.5.0";

import "openzeppelin-solidity/contracts/math/SafeMath.sol";
import "../DBC.sol";
import "../Feeds.sol";
import "../Registry.sol";
import "./ContractForDifferenceFactory.sol";
import "./ContractForDifferenceRegistry.sol";
import "./ContractForDifferenceLibrary.sol";


/*
 * SOLIUM DISABLE: 
 *
 *   security/no-send - using send instead of transfer as we'd like to log an 
 *      event on failure. See each send() below.
 *
 *   security/no-block-members - we need to use 'now' in order to set a time 
 *       limit.
 */

 /* solium-disable security/no-block-members */
 /* solium-disable security/no-send */

/**
 * @title Contract for difference
 *
 * Contract for difference for a given market between a
 * "buyer" (long position) and "seller" (short position).
 */
contract ContractForDifference is DBC {
    using SafeMath for uint;

    /*
     * Events
     */

    event LogCFDCreated(
        address creator,
        bytes32 market,
        uint notionalAmountWei,
        uint deposit
    );
    event LogCFDInitiated(
        address joiner,
        uint amountSent,
        address buyer,
        address seller,
        bytes32 market,
        uint notionalAmountWei,
        uint strikePrice,
        uint buyerDepositBalance,
        uint sellerDepositBalance
    );
    event LogCFDTransferPosition(address oldOwner, address newOwner);
    event LogCFDCanceledNew(address party, uint amount, bytes32 market);
    event LogCFDStrikePriceUpdated(address party, uint newStrikePrice);

    event LogCFDSale(
        address party,
        uint saleStrikePrice,
        uint timeLimit
    );
    event LogCFDSaleCancelled(address party);
    event LogCFDSaleUpdated(address party, uint newPrice);
    event LogCFDSold(address to, address by, uint newNotional, uint sellerAmount, uint buyerDeposit, bytes32 market);

    event LogCFDSendCollateralFailure(address receiver, uint amount);
    event LogCFDWithrewUnsent(address withdrawer);

    event LogCFDPartyBalanceUpdate(address party, uint amount, bool isWithdraw, uint newBalance, bytes32 market);
    event LogCFDTransferFunds(address receiver, uint amount);

    event LogCFDClosed(address winner, uint buyerCollateral, uint sellerCollateral, bytes32 market);
    event LogCFDForceTerminated(address terminator, uint terminatorAmount, address otherParty, uint otherPartyAmount, bytes32 market);
    event LogCFDUpgraded(address newCFD);
    event LogCFDRemainingBalanceUnexpected(uint remainder);

    enum Status {
        CREATED,
        INITIATED,
        SALE,
        CLOSED
    }

    /*
     * Constants
     */

    string constant REASON_NOTIONAL_TOO_LOW = "Notional below minimum";
    string constant REASON_FEES_NOT_ENOUGH = "Not enough sent to cover fees";
    string constant REASON_COLLATERAL_RANGE_FAILED = "collateralInRange false";
    string constant REASON_MUST_NOT_BE_INITIATED = "Must not be initiated";
    string constant REASON_MUST_NOT_BE_CLOSED = "Must not be closed";
    string constant REASON_MUST_NOT_BE_PARTY = "Contract party can't call this";
    string constant REASON_MUST_BE_INITIATED = "Must be initiated";
    string constant REASON_MUST_BE_SELLER = "msg.sender must be seller";
    string constant REASON_MUST_NOT_BE_SELLER = "msg.sender must not be seller";
    string constant REASON_MUST_BE_ON_SALE = "Must be on sale";
    string constant REASON_MUST_BE_POSITIVE_PRICE = "Price must be > 0";
    string constant REASON_ONLY_CONTRACT_PARTIES = "Only contract parties can do this";
    string constant REASON_MUST_BE_ACTIVE = "Must be active";
    string constant REASON_MARKET_PRICE_RANGE_FAILED = "collateralInRange false";
    string constant REASON_WITHDRAW_NOT_ENOUGH = "Can't withdraw more then available";
    string constant REASON_AMOUNT_NOT_ENOUGH = "Amount not enough";
    string constant REASON_UPGRADE_ALREADY_SET = "msg.sender already called";
    string constant REASON_UPGRADE_ALREADY_LATEST = "Already at latest version";
    string constant REASON_TRANSFER_TO_EXISTING_PARTY = "Can't transfer to existing party";

    uint public constant FORCE_TERMINATE_PENALTY_PERCENT = 5;
    uint public constant MINIMUM_NOTIONAL_AMOUNT_WEI = 10 finney;


    /*
     * State variables
     */

    address public buyer;                           // long
    address public seller;                          // short
    bytes32 public market;

    uint public notionalAmountWei;
    uint public buyerInitialNotional;
    uint public sellerInitialNotional;

    // format of strike prices as in Feeds contract - see Feeds.decimals()
    uint public strikePrice;
    uint public buyerInitialStrikePrice;
    uint public sellerInitialStrikePrice;

    // balances of amounts actually deposited/withdrawn from the contract
    uint public buyerDepositBalance;
    uint public sellerDepositBalance;

    mapping (address => uint) public withdrawable;

    uint public buyerSaleStrikePrice;
    uint public buyerSaleTimeLimit;

    uint public sellerSaleStrikePrice;
    uint public sellerSaleTimeLimit;

    bool public buyerSelling;
    bool public sellerSelling;

    bool public initiated = false;
    bool public closed = false;
    bool public terminated;

    // set to true for a short period of time - when second party has called
    // upgrade and upgrade has called the new factory to do the work
    bool public upgradeable = false;

    // set to first party that calls upgrade
    // enables identification of who called and that it has been called once
    address public upgradeCalledBy = 0x0;

    address public cfdRegistryAddr;
    address public feedsAddr;

    Registry public registry;

    /*
     * Functions
     */

    constructor() public {}

    /**
     * @dev Contract has been initiated (has 2 parties) and not yet terminated.
     * @return true if contract is active
     */
    function isActive() public view returns (bool) {
        return initiated == true && closed == false;
    }

    /**
     * @dev Is buyer / long party selling.
     * @return true if buyer has side up for sale
     */
    function isBuyerSelling() public view returns (bool) {
        return buyerSelling &&
            (buyerSaleTimeLimit == 0 || now < buyerSaleTimeLimit);
    }

    /**
     * @dev Is seller / short party selling.
     * @return true if seller has side up for sale
     */
    function isSellerSelling() public view returns (bool) {
        return sellerSelling &&
            (sellerSaleTimeLimit == 0 || now < sellerSaleTimeLimit);
    }

    /**
     * @dev If the given party is selling one side of the contract.
     * @return true if the given party is selling
     */
    function isSelling(address _party) public view returns (bool) {
        return (_party == buyer && isBuyerSelling()) ||
            (_party == seller && isSellerSelling());
    }

    /**
     * @dev Check if the given address is one of the 2 parties of the contract.
     * @param _party Address to check
     * @return true if _party is either the buyer or seller.
     */
    function isContractParty(address _party) public view returns (bool) {
        return _party == buyer || _party == seller;
    }

    /**
     * @dev Create a new CFDinstance specifying the terms of the contract.
     *
     * Fee of 0.3% of the notional is taken.
     *
     * Therefore the intial deposit is msg.value minus these fees.
     *
     * @param _registryAddr Registry contract address
     * @param _cfdRegistryAddr CFD Registry contract address
     * @param _feedsAddr Feeds address
     * @param _partyAddr Address of the party creating the contract
     * @param _marketId Contract is for prices on this market
     * @param _strikePrice Agreed initial price for the contract (compatible
                with Feeds stored price - see Feeds.decimals() adjustment)
     * @param _notionalAmountWei Contract amount
     * @param _isBuyer Flag indicating if the contract creator wants to take the
     *            buyer (true) or the seller side (false).
     */
    function create(
        address _registryAddr,
        address _cfdRegistryAddr,
        address _feedsAddr,
        address _partyAddr, // msg.sender calling the Factory
        bytes32 _marketId,
        uint _strikePrice,
        uint _notionalAmountWei,
        bool _isBuyer
    )
        public
        payable
        pre_cond(_notionalAmountWei >= MINIMUM_NOTIONAL_AMOUNT_WEI, REASON_NOTIONAL_TOO_LOW)
    {
        uint fees = ContractForDifferenceLibrary.creatorFee(_notionalAmountWei);
        if (msg.value <= fees)
            revert(REASON_FEES_NOT_ENOUGH);

        uint collateralSent = msg.value - fees;
        if (!ContractForDifferenceLibrary.collateralInRange(_notionalAmountWei, collateralSent))
            revert(REASON_COLLATERAL_RANGE_FAILED);

        if (_isBuyer) {
            buyer = _partyAddr;
            buyerDepositBalance = collateralSent;
        } else {
            seller = _partyAddr;
            sellerDepositBalance = collateralSent;
        }

        market = _marketId;
        notionalAmountWei = _notionalAmountWei;
        buyerInitialNotional = _notionalAmountWei;
        sellerInitialNotional = _notionalAmountWei;

        strikePrice = _strikePrice;
        buyerInitialStrikePrice = _strikePrice;
        sellerInitialStrikePrice = _strikePrice;

        cfdRegistryAddr = _cfdRegistryAddr;
        feedsAddr = _feedsAddr;
        registry = Registry(_registryAddr);

        emit LogCFDCreated(
            _partyAddr,
            market,
            notionalAmountWei,
            msg.value
        );
    }

    /**
     * @dev Create a new CFDinstance from a previous CFD instance. This is part
     *      of the upgrade process (see CFD.upgrade()).
     *
     * @param _cfdAddr Address of the existing / old CFD
     */
    function createByUpgrade(
        address _cfdAddr,
        address _registryAddr,
        address _cfdRegistryAddr,
        address _feedsAddr
    )
        public
        payable
    {
        ContractForDifference oldCfd = ContractForDifference(_cfdAddr);

        market = oldCfd.market();
        notionalAmountWei = oldCfd.notionalAmountWei();
        strikePrice = oldCfd.strikePrice();
        buyer = oldCfd.buyer();
        seller = oldCfd.seller();

        buyerDepositBalance = oldCfd.buyerDepositBalance();
        buyerInitialNotional = oldCfd.buyerInitialNotional();
        buyerInitialStrikePrice = oldCfd.buyerInitialStrikePrice();

        sellerDepositBalance = oldCfd.sellerDepositBalance();
        sellerInitialNotional = oldCfd.sellerInitialNotional();
        sellerInitialStrikePrice = oldCfd.sellerInitialStrikePrice();

        cfdRegistryAddr = _cfdRegistryAddr;
        registry = Registry(_registryAddr);
        feedsAddr = _feedsAddr;

        initiated = true;

        ContractForDifferenceRegistry(cfdRegistryAddr).registerParty(seller);
    }

    /**
     * Returns an array with all the attributes of the contract
     * (Had to split in 3 functions because of the stack limit)
     * Max number of return values == 8
     */
    function getCfdAttributes()
        public
        view
        returns (address, address, bytes32, uint, uint, bool, bool, Status)
    {
        return (
            buyer,
            seller,
            market,
            strikePrice,
            notionalAmountWei,
            buyerSelling,
            sellerSelling,
            status()
        );
    }
    function getCfdAttributes2()
        public
        view
        returns (uint, uint, uint, uint, uint, uint, uint, uint)
    {
        return (
            buyerInitialNotional,
            sellerInitialNotional,
            buyerDepositBalance,
            sellerDepositBalance,
            buyerSaleStrikePrice,
            sellerSaleStrikePrice,
            buyerInitialStrikePrice,
            sellerInitialStrikePrice
        );
    }
    function getCfdAttributes3()
        public
        view
        returns (bool, address)
    {
        return (
            terminated,
            upgradeCalledBy
        );
    }

    /**
     * @dev Counterparty deposits their funds into the contract thereby joining
     * and initiating the contract.
     *
     * Fee of 0.5% of the notional is taken.
     *
     * Therefore the intial deposit is msg.value minus these fees.
     */
    function deposit()
        external
        payable
        pre_cond(initiated == false, REASON_MUST_NOT_BE_INITIATED)
        pre_cond(closed == false, REASON_MUST_NOT_BE_CLOSED) // cancelNew has not been called
        pre_cond(isContractParty(msg.sender) == false, REASON_MUST_NOT_BE_PARTY) // reject contract creator depositing
    {
        uint joinerFees = ContractForDifferenceLibrary.joinerFee(notionalAmountWei);
        if (msg.value <= joinerFees)
            revert(REASON_FEES_NOT_ENOUGH);

        uint collateralSent = msg.value - joinerFees;
        if (!ContractForDifferenceLibrary.collateralInRange(notionalAmountWei, collateralSent))
            revert(REASON_COLLATERAL_RANGE_FAILED);

        if (buyer == 0x0) {
            buyer = msg.sender;
            buyerDepositBalance = collateralSent;
        } else {
            seller = msg.sender;
            sellerDepositBalance = collateralSent;
        }

        uint feeAmount = joinerFees + ContractForDifferenceLibrary.creatorFee(notionalAmountWei);
        registry.getFees().transfer(feeAmount);

        initiated = true;
        ContractForDifferenceRegistry(cfdRegistryAddr).registerParty(msg.sender);
        emit LogCFDInitiated(
            msg.sender,
            msg.value,
            buyer,
            seller,
            market,
            notionalAmountWei,
            strikePrice,
            buyerDepositBalance,
            sellerDepositBalance
        );
    }

    /**
     * @dev Cancels a newly created contract refunding the balance to the party
     *      that created the contract. This can only be called before a contract
     *      is initiated. ie. between the create() and deposit() calls.
     */
    function cancelNew()
        external
        pre_cond(initiated == false, REASON_MUST_NOT_BE_INITIATED)
        pre_cond(isContractParty(msg.sender), REASON_ONLY_CONTRACT_PARTIES)
    {
        uint amountSent = address(this).balance;
        if (!msg.sender.send(amountSent)) {
            withdrawable[msg.sender] = amountSent;
            emit LogCFDSendCollateralFailure(msg.sender, amountSent);
        } else {
            emit LogCFDTransferFunds(msg.sender, amountSent);
        }
        closed = true;
        emit LogCFDCanceledNew(msg.sender, amountSent, market);
    }

    /**
     * @dev Party adds more funds to the contract thereby increasing their
     *      deposit balance.
     */
    function topup()
        external
        payable
        pre_cond(msg.value >= 1, REASON_AMOUNT_NOT_ENOUGH)
        pre_cond(initiated == true, REASON_MUST_BE_INITIATED)
        pre_cond(closed == false, REASON_MUST_NOT_BE_CLOSED)
        pre_cond(isContractParty(msg.sender), REASON_ONLY_CONTRACT_PARTIES)
        pre_cond(isSelling(msg.sender) == false, REASON_MUST_NOT_BE_SELLER)
    {
        bool isBuyer = msg.sender == buyer;
        uint newDepositBalance = (isBuyer ? 
            buyerDepositBalance : 
            sellerDepositBalance
        ).add(msg.value);

        // check topup doesn't make collateral exceed the maximum
        if (!ContractForDifferenceLibrary.collateralInRange(notionalAmountWei, newDepositBalance))
            revert(REASON_COLLATERAL_RANGE_FAILED);

        if (isBuyer) {
            buyerDepositBalance = newDepositBalance;
        } else {
            sellerDepositBalance = newDepositBalance;
        }

        emit LogCFDPartyBalanceUpdate(msg.sender, msg.value, false, newDepositBalance, market);
    }

    /**
     * @dev Party withdraws funds from the contract.
     *      They can only withdraw down to an amount that leaves the collateral
     *      to notional difference at 20% or more.
     * @param _withdrawAmount Amount to withdraw from the deposits balance.
     */
    function withdraw(uint _withdrawAmount)
        external
        assertWithdrawPreCond(_withdrawAmount)
    {
        bool isBuyer = msg.sender == buyer;
        uint currentDepositBal = isBuyer ? buyerDepositBalance : sellerDepositBalance;

        // first simple check that can't withdraw more then deposited
        if (_withdrawAmount > currentDepositBal)
            revert(REASON_WITHDRAW_NOT_ENOUGH);

        // second a more precise check that the collateral at new balance will remain above the min
        uint newDepositBal = currentDepositBal - _withdrawAmount;
        uint marketPrice = latestPrice();
        if (!marketPriceInRange(
            marketPrice,
            isBuyer ? newDepositBal : buyerDepositBalance,
            isBuyer ? sellerDepositBalance : newDepositBal,
            strikePrice // unchanged on withdraw
        )) {
            revert(REASON_MARKET_PRICE_RANGE_FAILED);
        }

        uint collateral = ContractForDifferenceLibrary.calculateCollateralAmount(
            strikePrice,
            marketPrice,
            notionalAmountWei,
            newDepositBal,
            isBuyer
        );

        if (!ContractForDifferenceLibrary.collateralInRange(notionalAmountWei, collateral)) {
            revert(REASON_COLLATERAL_RANGE_FAILED);
        }

        if (!msg.sender.send(_withdrawAmount)) {
            withdrawable[msg.sender] = _withdrawAmount;
            emit LogCFDSendCollateralFailure(msg.sender, _withdrawAmount);
        } else {
            emit LogCFDTransferFunds(msg.sender, _withdrawAmount);
        }

        if (isBuyer) {
            buyerDepositBalance = newDepositBal;
        } else {
            sellerDepositBalance = newDepositBal;
        }

        emit LogCFDPartyBalanceUpdate(msg.sender, _withdrawAmount, true, newDepositBal, market);
    }

    /* NOTE: Split off into modifier to work around 'stack too deep' error */
    modifier assertWithdrawPreCond(uint _withdrawAmount) 
    {
        require(_withdrawAmount >= 1);
        require(initiated == true);
        require(closed == false);
        require(isContractParty(msg.sender));
        require(isSelling(msg.sender) == false);
        _;
    }

    /**
     * @dev Parties can transfer contract ownership to another address by
     *      calling this function.
     * @param _newAddress Addreess of the new party to swap in.
     */
    function transferPosition(address _newAddress)
        external
        pre_cond(closed == false, REASON_MUST_NOT_BE_CLOSED)
        pre_cond(isContractParty(msg.sender), REASON_ONLY_CONTRACT_PARTIES)
        pre_cond(isContractParty(_newAddress) == false, REASON_MUST_NOT_BE_PARTY)
        pre_cond(isSelling(msg.sender) == false, REASON_MUST_NOT_BE_SELLER)
    {
        if (msg.sender == buyer) buyer = _newAddress;
        if (msg.sender == seller) seller = _newAddress;
        if (msg.sender == upgradeCalledBy) upgradeCalledBy = 0x0;
        ContractForDifferenceRegistry(cfdRegistryAddr).registerParty(_newAddress);
        emit LogCFDTransferPosition(msg.sender, _newAddress);
    }

    /**
     * @dev Position in a contract can be sold to another party. This function
     *      makes the callers side available for sale. A party can buy the side
     *      with the buy function.
     * @param _desiredStrikePrice Sellers desired sell strike price
     * @param _timeLimit Sale available until this time in UNIX epoch seconds
     *                  (< now for no limit)
     */
    function sellPrepare(uint _desiredStrikePrice, uint _timeLimit)
        external
        payable
        pre_cond(isContractParty(msg.sender), REASON_ONLY_CONTRACT_PARTIES)
        pre_cond(isActive(), REASON_MUST_BE_ACTIVE)
        // reject already marked selling by the caller
        pre_cond(isSelling(msg.sender) == false, REASON_MUST_NOT_BE_SELLER)
        pre_cond(_desiredStrikePrice > 0, REASON_MUST_BE_POSITIVE_PRICE)
    {
        // mark side on sale
        uint timeLimit = timeLimitFutureOrZero(_timeLimit);
        if (msg.sender == buyer) {
            buyerSelling = true;
            buyerSaleStrikePrice = _desiredStrikePrice;
            buyerSaleTimeLimit = timeLimit;
        } else if (msg.sender == seller) {
            sellerSelling = true;
            sellerSaleStrikePrice = _desiredStrikePrice;
            sellerSaleTimeLimit = timeLimit;
        }

        ContractForDifferenceRegistry(cfdRegistryAddr).registerSale(msg.sender);
        emit LogCFDSale(
            msg.sender,
            _desiredStrikePrice,
            timeLimit
        );
    }

    /**
     * @dev Seller can update the price on the sale.
     */
    function sellUpdate(
        uint _newPrice
    )
        external
        pre_cond(isActive(), REASON_MUST_BE_ACTIVE)
        pre_cond(isSelling(msg.sender), REASON_MUST_BE_SELLER)
        pre_cond(_newPrice > 0, REASON_MUST_BE_POSITIVE_PRICE)
    {
        if (msg.sender == buyer) {
            buyerSaleStrikePrice = _newPrice;
        } else if (msg.sender == seller) {
            sellerSaleStrikePrice = _newPrice;
        }
        emit LogCFDSaleUpdated(msg.sender, _newPrice);
    }

    /**
     * @dev Party can update the strike price of an non-initialized contract
     */
    function changeStrikePrice(
        uint _newStrikePrice
    )
        external
        payable
        pre_cond(initiated == false, REASON_MUST_NOT_BE_INITIATED)
        pre_cond(closed == false, REASON_MUST_NOT_BE_CLOSED)
        pre_cond(isContractParty(msg.sender), REASON_ONLY_CONTRACT_PARTIES)
        pre_cond(_newStrikePrice > 0, REASON_MUST_BE_POSITIVE_PRICE)
    {
        strikePrice = _newStrikePrice;
        buyerInitialStrikePrice = _newStrikePrice;
        sellerInitialStrikePrice = _newStrikePrice;
        emit LogCFDStrikePriceUpdated(msg.sender, _newStrikePrice);
    }

    /**
     * @dev Cancel the for sale status setup by sellPrepare()
     */
    function sellCancel()
        external
        pre_cond(isActive(), REASON_MUST_BE_ACTIVE)
        pre_cond(isSelling(msg.sender), REASON_MUST_BE_SELLER)
    {
        clearSale(msg.sender == buyer);
        emit LogCFDSaleCancelled(msg.sender);
    }

    /**
     * @dev Buy the side in the contract that is for sale.
     *
     * Fee of 0.5% of the notional is taken.
     *
     * @param _buyBuyerSide Buying the buyer side or the seller side?
     */
    function buy(bool _buyBuyerSide)
        external
        payable
        assertBuyPreCond(_buyBuyerSide)
    {
        uint fees = ContractForDifferenceLibrary.joinerFee(notionalAmountWei);
        if (msg.value <= fees)
            revert(REASON_FEES_NOT_ENOUGH);

        registry.getFees().transfer(fees);

        // check sent collateral falls in the allowable range
        uint collateralSent = msg.value.sub(fees);
        if (!ContractForDifferenceLibrary.collateralInRange(notionalAmountWei, collateralSent))
            revert(REASON_COLLATERAL_RANGE_FAILED);

        uint marketPrice = latestPrice();
        uint newStrikePrice = _buyBuyerSide ?
            buyerSaleStrikePrice :
            sellerSaleStrikePrice;

        // check new parameters fall in the allowable range
        if (!marketPriceInRange(
            marketPrice,
            _buyBuyerSide ? collateralSent : buyerDepositBalance,
            _buyBuyerSide ? sellerDepositBalance : collateralSent,
            newStrikePrice // buying at this strike price
        )) {
            revert(REASON_MARKET_PRICE_RANGE_FAILED);
        }

        // transfer to selling party and to fees address
        address sellingParty = _buyBuyerSide ? buyer : seller;
        uint sellingPartyCollateral = buyTransferFunds(
            _buyBuyerSide,
            newStrikePrice,
            sellingParty
        );

        // set new party and balances
        uint remainingPartyDeposits = address(this).balance.sub(collateralSent);

        // new notional amount value
        uint newNotional = ContractForDifferenceLibrary.calculateNewNotional(
            notionalAmountWei,
            strikePrice,
            newStrikePrice
        );

        if (_buyBuyerSide) {
            buyer = msg.sender;
            buyerDepositBalance = collateralSent;
            buyerInitialStrikePrice = newStrikePrice;
            buyerInitialNotional = newNotional;
            sellerDepositBalance = remainingPartyDeposits;
        } else {
            seller = msg.sender;
            sellerDepositBalance = collateralSent;
            sellerInitialStrikePrice = newStrikePrice;
            sellerInitialNotional = newNotional;
            buyerDepositBalance = remainingPartyDeposits;
        }

        strikePrice = newStrikePrice;
        notionalAmountWei = newNotional;

        clearSale(_buyBuyerSide);

        // clean up upgradeCalledBy if the departing party had set that
        if (upgradeCalledBy == sellingParty) {
            upgradeCalledBy = 0x0;
        }

        ContractForDifferenceRegistry(cfdRegistryAddr).registerParty(msg.sender);
        emit LogCFDSold(msg.sender, sellingParty, newNotional, sellingPartyCollateral, msg.value, market);
    }

    /* NOTE: Split off into modifier to work around 'stack too deep' error */
    modifier assertBuyPreCond(bool _buyBuyerSide) 
    {
        require(isActive());
        require(isSelling(_buyBuyerSide ? buyer : seller));
        require(isContractParty(msg.sender) == false);
        _;
    }

    /**
     * Does all transfers of funds related to the buy().
     *
     * Transfer logic split off in seperate function ONLY to workaround
     * 'Stack too deep' limit.
     */
    function buyTransferFunds(
        bool buyBuyerSide,
        uint newStrikePrice,
        address sellingParty
    )
        private
        returns (uint sellingPartyCollateral)
    {
        // determine collateral amount to send to the selling party
        sellingPartyCollateral = ContractForDifferenceLibrary.calculateCollateralAmount(
            strikePrice,
            newStrikePrice,
            notionalAmountWei,
            buyBuyerSide ? buyerDepositBalance : sellerDepositBalance,
            buyBuyerSide
        );

        // send money to selling party
        if (!sellingParty.send(sellingPartyCollateral)) {
            withdrawable[sellingParty] = sellingPartyCollateral;
            emit LogCFDSendCollateralFailure(sellingParty, sellingPartyCollateral);
        } else {
            emit LogCFDTransferFunds(sellingParty, sellingPartyCollateral);
        }
    }

    /**
     * @dev Daemons will call this routine when the market price has moved
     *      enough that the closeRatio for this contract has been reached.
     *      It can actually be called by anyone who is willing to pay the gas
     *      for the liquidate. But if the market has moved past the liquidate
     *      threshold the call will be rejected.
     *
     * This will disolve the contract and return each parties balance of
     * collateral.
     */
    function liquidate()
        external
        pre_cond(isActive(), REASON_MUST_BE_ACTIVE)
    {
        uint marketPrice = latestPrice();

        // #11 double check the 5% threshold was crossed, if not then REJECT
        // (can only liquidate if out of range)
        require(
            !marketPriceInRange(
                marketPrice,
                buyerDepositBalance,
                sellerDepositBalance,
                strikePrice
            ), 
            "Liquidate threshold not yet reached"
        );

        // fetch one of the cutoffs to determine which is the winner
        uint buyerCutOff = ContractForDifferenceLibrary.cutOffPrice(
            notionalAmountWei,
            buyerDepositBalance,
            strikePrice,
            true
        );

        // if buyer cutoff still in range then buyer wins, otherwise seller
        bool winnerIsBuyer = marketPrice > buyerCutOff;
        address winner = winnerIsBuyer ? buyer : seller;

        // winner takes all
        uint remaining = address(this).balance;
        if (!winner.send(remaining)) {
            withdrawable[winner] = remaining;
            emit LogCFDSendCollateralFailure(winner, remaining);
        } else {
            emit LogCFDTransferFunds(winner, remaining);
        }

        closed = true;

        emit LogCFDClosed(
            winner,
            winnerIsBuyer ? remaining : 0,
            winnerIsBuyer ? 0 : remaining,
            market
        );
    }

    /**
     * Force terminate executed by one party who will penalised 5% of their
     * collateral. Then penalty will be sent to the counterparty.
     */
    function forceTerminate()
        external
        pre_cond(isActive(), REASON_MUST_BE_ACTIVE)
        pre_cond(isContractParty(msg.sender), REASON_ONLY_CONTRACT_PARTIES)
    {
        uint marketPrice = latestPrice();
        bool forcingPartyIsBuyer = msg.sender == buyer;

        uint buyerCollateral = ContractForDifferenceLibrary.calculateCollateralAmount(
            strikePrice,
            marketPrice,
            notionalAmountWei,
            buyerDepositBalance,
            true
        );
        uint sellerCollateral = ContractForDifferenceLibrary.calculateCollateralAmount(
            strikePrice,
            marketPrice,
            notionalAmountWei,
            sellerDepositBalance,
            false
        );

        //
        // calculate and check the remainder - it should be equal to zero
        //
        // if not expected log the event and transfer the remainder to fees - it
        //     will be sorted out manually
        //
        uint balanceRemainder = address(this).balance.sub(buyerCollateral).sub(sellerCollateral);
        if (balanceRemainder != 0) {
            emit LogCFDRemainingBalanceUnexpected(balanceRemainder);
        }
        registry.getFees().transfer(balanceRemainder);

        // penalise the force terminator 5% and give it to the counterparty
        uint penalty = ContractForDifferenceLibrary.percentOf(
            forcingPartyIsBuyer ? buyerCollateral : sellerCollateral,
            FORCE_TERMINATE_PENALTY_PERCENT
        );
        if (forcingPartyIsBuyer) {
            buyerCollateral = buyerCollateral.sub(penalty);
            sellerCollateral = sellerCollateral.add(penalty);
        } else {
            buyerCollateral = buyerCollateral.add(penalty);
            sellerCollateral = sellerCollateral.sub(penalty);
        }

        // Send collateral amounts back each party.
        //
        // If a send fails then log the failure and make the amount available
        // for withdrawal.
        //
        // NOTE: send here gets only 2100 gas so these calls are not at risk of
        // reentrancy
        if (!buyer.send(buyerCollateral)) {
            withdrawable[buyer] = buyerCollateral;
            emit LogCFDSendCollateralFailure(buyer, buyerCollateral);
        } else {
            emit LogCFDTransferFunds(buyer, buyerCollateral);
        }

        if (!seller.send(sellerCollateral)) {
            withdrawable[seller] = sellerCollateral;
            emit LogCFDSendCollateralFailure(seller, sellerCollateral);
        } else {
            emit LogCFDTransferFunds(seller, sellerCollateral);
        }

        terminated = true;
        closed = true;

        if (forcingPartyIsBuyer)
            emit LogCFDForceTerminated(buyer, buyerCollateral, seller, sellerCollateral, market);
        else
            emit LogCFDForceTerminated(seller, sellerCollateral, buyer, buyerCollateral, market);
    }

    /**
     * @dev Upgrade contract to a new version. This involves creating a new CFD
     *      at the latest contract set - transferring over all properties and
     *      value from this one to the new one.
     *      An upgrade requires a call to this function from both parties. Then
     *      upgrade will happen when the second party makes the call.
     */
    function upgrade()
        external
        pre_cond(isContractParty(msg.sender), REASON_ONLY_CONTRACT_PARTIES)
        pre_cond(isActive(), REASON_MUST_BE_ACTIVE)
        pre_cond(isSelling(msg.sender) == false, REASON_MUST_NOT_BE_SELLER)
        pre_cond(msg.sender != upgradeCalledBy, REASON_UPGRADE_ALREADY_SET)
        pre_cond(registry.allCFDs(this) != registry.getCFDFactoryLatest(), REASON_UPGRADE_ALREADY_LATEST)
    {
        // 1st call to initiate upgrade process
        if (upgradeCalledBy == 0x0) {
            upgradeCalledBy = msg.sender;
            return;
        }

        // if here then then this is the 2nd call, invoked by the opposite, so
        // kick off the upgrade process
        upgradeable = true;
        address cfdFactoryLatest = registry.getCFDFactoryLatest();
        address newCfd = ContractForDifferenceFactory(cfdFactoryLatest).
            createByUpgrade.value(address(this).balance)();
        upgradeable = false;
        closed = true;

        emit LogCFDUpgraded(newCfd);
    }

    /**
     * @dev Derive status from the state variables.
     * @return Status reflecting the current state.
     */
    function status()
        public
        view
        returns (Status)
    {
        if (closed == true)
            return Status.CLOSED;
        else if (initiated == false)
            return Status.CREATED;
        else if (isBuyerSelling() || isSellerSelling())
            return Status.SALE;
        else
            return Status.INITIATED;
    }

    /**
     * @dev Withdraw funds that failed to send in a previous a transaction.
     *
     * See event LogCFDSendCollateralFailure.
     */
    function withdrawUnsent()
        external
        pre_cond(withdrawable[msg.sender] > 0, REASON_WITHDRAW_NOT_ENOUGH)
    {
        uint amount = withdrawable[msg.sender];
        withdrawable[msg.sender] = 0;
        msg.sender.transfer(amount);
        emit LogCFDWithrewUnsent(msg.sender);
    }

    /**
     * Get the latest read for the market of this CFD.
     */
    function latestPrice()
        internal
        view
        returns (uint price)
    {
        uint marketPrice;
        (marketPrice, ) = Feeds(feedsAddr).read(market);
        return marketPrice;
    }

    /**
     * @dev Checks if given parameters and given market price result in a price
     *      inside an allowable range. This range is defined by the ContractForDifferenceLibrary.cutOffPrice
     *      function formulas. The idea is that as parameters change - leverage,
     *      market price etc., we must check the change doesn't result in a
     *      liquidation event due to too little collateral.
     *
     * @param _marketPrice Current market price
     * @return true if in range; false if not
     */

    function marketPriceInRange(
        uint _marketPrice,
        uint _buyerDepositBalance,
        uint _sellerDepositBalance,
        uint _strikePrice
    )
        public
        view
        returns (bool inRange)
    {
        uint buyerCutOff = ContractForDifferenceLibrary.cutOffPrice(
            notionalAmountWei,
            _buyerDepositBalance,
            _strikePrice,
            true
        );
        uint sellerCutOff = ContractForDifferenceLibrary.cutOffPrice(
            notionalAmountWei,
            _sellerDepositBalance,
            _strikePrice,
            false
        );
        inRange = _marketPrice > buyerCutOff && _marketPrice < sellerCutOff;
    }

   /**
     * @dev Calculate new notional amount after a side has been sold at a new
     *      strike price.
     *
     * Formula is:
     *  N2 = N1 * S2 / S1
     * Where:
     *  N1 = previous notional
     *  S1 = previous strike price
     *  S2 = sale strike price
     *
     * @param _oldNotional Existing notional.
     * @param _oldStrikePrice Existing strike price.
     * @param _newStrikePrice New / Sale strike price.
     * @return newNotional Result of the calculation.
     */
    function calculateNewNotional(
        uint _oldNotional,
        uint _oldStrikePrice,
        uint _newStrikePrice
    )
        public
        pure
        returns (uint newNotional)
    {
        newNotional = ContractForDifferenceLibrary.calculateNewNotional(
            _oldNotional,
            _oldStrikePrice,
            _newStrikePrice
        );
    }

    /**
     * @dev Calculate the collateral amount for one party given the current
     *      market price and original strike price, notional amount and the
     *      amount the party has deposited into the contract.
     *
     * @param _marketPrice Current market price
     * @param _strikePrice CFD strike price
     * @param _notionalAmount CFD notional amount
     * @param _depositBalance Balances of deposits into the contract
     * @param _isBuyer Buyer or Seller / Long or short party?
     *
     * @return collateral Amount of collateral for the party
     */
    function calculateCollateralAmount(
        uint _strikePrice,
        uint _marketPrice,
        uint _notionalAmount,
        uint _depositBalance,
        bool _isBuyer
    )
        public
        pure
        returns (uint collateral)
    {
        collateral = ContractForDifferenceLibrary.calculateCollateralAmount(
            _strikePrice,
            _marketPrice,
            _notionalAmount,
            _depositBalance,
            _isBuyer
        );
    }

    /**
     * @dev Calculate the cut off price for buyer or seller.
     *
     * This is the price that if passed would raise a liquidation event.
     *
     * Base Formulas are:
     *     Buyer:  1.05 * S - depositBalanceLong  * S / N
     *     Seller: 0.95 * S + depositBalanceShort * S / N
     *
     * However for Solidity we need to adjust parts by FACTOR_UINT to ensure
     * no fractions.
     *
     * @param _notionalAmountWei Contract notional amount
     * @param _depositBalance Balance of deposits for one party
     *
     * @return cut off price
     */
    function cutOffPrice(
        uint _notionalAmountWei,
        uint _depositBalance,
        uint _strikePrice,
        bool _calcForBuyerSide
    )
        public
        pure
        returns (uint price)
    {
        price = ContractForDifferenceLibrary.cutOffPrice(
            _notionalAmountWei,
            _depositBalance,
            _strikePrice,
            _calcForBuyerSide
        );
    }

    /**
     * Creator fee - 0.3% of notional.
     */
    function creatorFee(uint _notional) public pure returns (uint fee) {
        fee = ContractForDifferenceLibrary.creatorFee(_notional);
    }

    /**
     * Joiner (deposit or buy) percentage fee - 0.5% of notional.
     */
    function joinerFee(uint _notional) public pure returns (uint fee) {
        fee = ContractForDifferenceLibrary.joinerFee(_notional);
    }

    /**
     * @dev Calculate the change in contract value based on the price change.
     * @param _currentPrice Current market price
     */
    function changeInWei(
        uint _strikePrice,
        uint _currentPrice,
        uint _notionalAmount
    )
        public
        pure
        returns (uint change)
    {
        change = ContractForDifferenceLibrary.changeInWei(
            _strikePrice,
            _currentPrice,
            _notionalAmount
        );
    }

    /**
     * @dev Return a percentage change comparing a value with a new value.
     * @param _value The existing value to compare against
     * @param _newValue The new value to compare the change against
     * @return Percentage change (eg. _value = 100, _newValue = 90 then return 10)
     */
    function percentChange(uint _value, uint _newValue)
        public
        pure
        returns (uint percent)
    {
        percent = ContractForDifferenceLibrary.percentChange(_value, _newValue);
    }

    /**
     * @dev Return a percentage of a given amount.
     * @param _amount Amount to calculate the percentage of
     * @param _percent Percent amount (1 - 100)
     */
    function percentOf(uint _amount, uint _percent)
        public
        pure
        returns (uint adjusted)
    {
        adjusted = ContractForDifferenceLibrary.percentOf(_amount, _percent);
    }

    /**
     * Utility that given a time limit will preverve it if in the future OR
     * set it to 0 if it's in the present or past.
     */
    function timeLimitFutureOrZero(
        uint _timeLimit
    )
        private
        view // not pure because of 'now'
        returns(uint timeLimit)
    {
        timeLimit = (_timeLimit > now) ? _timeLimit : 0;
    }

    /**
     * Clear all sale related state.
     */
    function clearSale(bool _clearBuyerSide) private {
        if (_clearBuyerSide) {
            buyerSaleStrikePrice = 0;
            buyerSaleTimeLimit = 0;
            buyerSelling = false;
        } else {
            sellerSaleStrikePrice = 0;
            sellerSaleTimeLimit = 0;
            sellerSelling = false;
        }
    }
}
