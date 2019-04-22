pragma solidity ^0.5.0;

import "openzeppelin-solidity/contracts/math/SafeMath.sol";
import "../DBC.sol";
import "../feeds/PriceFeeds.sol";
import "../Registry.sol";
import "./ContractForDifferenceFactory.sol";
import "./ContractForDifferenceRegistry.sol";
import "./ContractForDifferenceLibrary.sol";


/*
 * SOLIUM DISABLE: 
 *
 *   security/no-block-members - we need to use 'now' in order to set a time 
 *       limit.
 */

 /* solium-disable security/no-block-members */

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
        uint notionalAmountDai,
        uint deposit
    );
    event LogCFDInitiated(
        address joiner,
        uint amountSent,
        address buyer,
        address seller,
        bytes32 market,
        uint notionalAmountDai,
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
    string constant REASON_DAI_TRANSFER_FAILED = "Failure transfering ownership of DAI tokens";
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
    string constant REASON_MUST_BE_MORE_THAN_CUTOFF = "Must be more than liquidation price";
    string constant REASON_MUST_BE_LESS_THAN_CUTOFF = "Must be less than liquidation price";

    uint public constant FORCE_TERMINATE_PENALTY_PERCENT = 5;
    uint public constant MINIMUM_NOTIONAL_AMOUNT_DAI = 1 * 1e18; // 1 DAI/1 USD


    /*
     * State variables
     */

    address public buyer;                           // long
    address public seller;                          // short
    bytes32 public market;

    uint public notionalAmountDai;
    uint public buyerInitialNotional;
    uint public sellerInitialNotional;

    // strike prices as prices stored in PriceFeeds
    uint public strikePrice;
    uint public buyerInitialStrikePrice;
    uint public sellerInitialStrikePrice;

    // balances of amounts actually deposited/withdrawn from the contract
    uint public buyerDepositBalance;
    uint public sellerDepositBalance;

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
    address public upgradeCalledBy = address(0);

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
     * Therefore the intial deposit is _value minus these fees.
     *
     * @param _registryAddr Registry contract address
     * @param _cfdRegistryAddr CFD Registry contract address
     * @param _feedsAddr Feeds address
     * @param _partyAddr Address of the party creating the contract
     * @param _marketId Contract is for prices on this market
     * @param _strikePrice Strike price
     * @param _notionalAmountDai Contract amount
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
        uint _notionalAmountDai,
        bool _isBuyer
    )
        public
        pre_cond(_notionalAmountDai >= MINIMUM_NOTIONAL_AMOUNT_DAI, REASON_NOTIONAL_TOO_LOW)
    {
        registry = Registry(_registryAddr);
        uint daiBalance = registry.getDAI().balanceOf(address(this));
        uint fees = ContractForDifferenceLibrary.creatorFee(_notionalAmountDai);
        if (daiBalance <= fees)
            revert(REASON_FEES_NOT_ENOUGH);

        uint collateralSent = daiBalance - fees;
        if (!ContractForDifferenceLibrary.collateralInRange(_notionalAmountDai, collateralSent))
            revert(REASON_COLLATERAL_RANGE_FAILED);

        if (_isBuyer) {
            buyer = _partyAddr;
            buyerDepositBalance = collateralSent;
        } else {
            seller = _partyAddr;
            sellerDepositBalance = collateralSent;
        }

        market = _marketId;
        notionalAmountDai = _notionalAmountDai;
        buyerInitialNotional = _notionalAmountDai;
        sellerInitialNotional = _notionalAmountDai;

        strikePrice = _strikePrice;
        buyerInitialStrikePrice = _strikePrice;
        sellerInitialStrikePrice = _strikePrice;

        cfdRegistryAddr = _cfdRegistryAddr;
        feedsAddr = _feedsAddr;

        emit LogCFDCreated(
            _partyAddr,
            market,
            notionalAmountDai,
            daiBalance
        );
    }

    /**
     * @dev Create a new CFDinstance from a previous CFD instance. This is part
     *      of the upgrade process (see CFD.upgrade()).
     *
     * @param _cfdAddr Address of the existing / old CFD
     * @param _registryAddr Address of Registry contract
     * @param _cfdRegistryAddr Address of CFDRegistry contract
     * @param _feedsAddr Address to send fees to
     */
    function createByUpgrade(
        address _cfdAddr,
        address _registryAddr,
        address _cfdRegistryAddr,
        address _feedsAddr
    )
        // NOTE on security: any address can call this however if the CFD 
        // instance has not yet been added to the ContractForDifferentRegistry
        // (which only ContractForDifferenceFactory can do) then this
        // function will fail at registerParty() below.
        // Of course someone can call this with a fake 
        // ContractForDifferenceRegistry but then nothing will touch
        // or change the state of the 0xfutures set of deployed contracts.
        public
    {
        ContractForDifference oldCfd = ContractForDifference(_cfdAddr);

        market = oldCfd.market();
        notionalAmountDai = oldCfd.notionalAmountDai();
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
            notionalAmountDai,
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
     * Therefore the intial deposit is _value minus these fees.
     */
    function deposit(uint _value)
        external
        pre_cond(initiated == false, REASON_MUST_NOT_BE_INITIATED)
        pre_cond(closed == false, REASON_MUST_NOT_BE_CLOSED) // cancelNew has not been called
        pre_cond(isContractParty(msg.sender) == false, REASON_MUST_NOT_BE_PARTY) // reject contract creator depositing
    {
        uint joinerFees = ContractForDifferenceLibrary.joinerFee(notionalAmountDai);
        if (_value <= joinerFees)
            revert(REASON_FEES_NOT_ENOUGH);

        uint collateralSent = _value - joinerFees;
        if (!ContractForDifferenceLibrary.collateralInRange(notionalAmountDai, collateralSent))
            revert(REASON_COLLATERAL_RANGE_FAILED);

        daiClaim(_value);
        daiTransferToFees(
            joinerFees + ContractForDifferenceLibrary.creatorFee(notionalAmountDai)
        );

        if (buyer == address(0)) {
            buyer = msg.sender;
            buyerDepositBalance = collateralSent;
        } else {
            seller = msg.sender;
            sellerDepositBalance = collateralSent;
        }

        initiated = true;
        ContractForDifferenceRegistry(cfdRegistryAddr).registerParty(msg.sender);
        emit LogCFDInitiated(
            msg.sender,
            _value,
            buyer,
            seller,
            market,
            notionalAmountDai,
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
        uint amountSent = registry.getDAI().balanceOf(address(this));
        daiTransfer(msg.sender, amountSent);
        emit LogCFDTransferFunds(msg.sender, amountSent);
        closed = true;
        emit LogCFDCanceledNew(msg.sender, amountSent, market);
    }

    /**
     * @dev Party adds more funds to the contract thereby increasing their
     *      deposit balance.
     * @param _value DAI amount
     */
    function topup(uint _value)
        external
        pre_cond(_value >= 1, REASON_AMOUNT_NOT_ENOUGH)
        pre_cond(initiated == true, REASON_MUST_BE_INITIATED)
        pre_cond(closed == false, REASON_MUST_NOT_BE_CLOSED)
        pre_cond(isContractParty(msg.sender), REASON_ONLY_CONTRACT_PARTIES)
        pre_cond(isSelling(msg.sender) == false, REASON_MUST_NOT_BE_SELLER)
    {
        bool isBuyer = msg.sender == buyer;
        uint newDepositBalance = (isBuyer ? 
            buyerDepositBalance : 
            sellerDepositBalance
        ).add(_value);

        // check topup doesn't make collateral exceed the maximum
        if (!ContractForDifferenceLibrary.collateralInRange(notionalAmountDai, newDepositBalance))
            revert(REASON_COLLATERAL_RANGE_FAILED);

        daiClaim(_value);

        if (isBuyer) {
            buyerDepositBalance = newDepositBalance;
        } else {
            sellerDepositBalance = newDepositBalance;
        }

        emit LogCFDPartyBalanceUpdate(msg.sender, _value, false, newDepositBalance, market);
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
            notionalAmountDai,
            newDepositBal,
            isBuyer
        );

        if (!ContractForDifferenceLibrary.collateralInRange(notionalAmountDai, collateral)) {
            revert(REASON_COLLATERAL_RANGE_FAILED);
        }

        daiTransfer(msg.sender, _withdrawAmount);
        emit LogCFDTransferFunds(msg.sender, _withdrawAmount);

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
        require(_withdrawAmount >= 1, REASON_WITHDRAW_NOT_ENOUGH);
        require(initiated == true, REASON_MUST_BE_INITIATED);
        require(closed == false, REASON_MUST_NOT_BE_CLOSED);
        require(isContractParty(msg.sender), REASON_ONLY_CONTRACT_PARTIES);
        require(isSelling(msg.sender) == false, REASON_MUST_NOT_BE_SELLER);
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
        else if (msg.sender == seller) seller = _newAddress;
        else if (msg.sender == upgradeCalledBy) upgradeCalledBy = address(0);
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
        pre_cond(isContractParty(msg.sender), REASON_ONLY_CONTRACT_PARTIES)
        pre_cond(isActive(), REASON_MUST_BE_ACTIVE)
        // reject already marked selling by the caller
        pre_cond(isSelling(msg.sender) == false, REASON_MUST_NOT_BE_SELLER)
        pre_cond(_desiredStrikePrice > 0, REASON_MUST_BE_POSITIVE_PRICE)
    {
        // calculate cutoff price
        bool isBuyer = (msg.sender == buyer) ? true : false;
        uint cutOff = ContractForDifferenceLibrary.cutOffPrice(
            notionalAmountDai,
            (isBuyer) ? buyerDepositBalance : sellerDepositBalance,
            (isBuyer) ? buyerInitialStrikePrice : sellerInitialStrikePrice,
            isBuyer
        );

        // mark side on sale
        uint timeLimit = timeLimitFutureOrZero(_timeLimit);
        if (msg.sender == buyer) {
            // check sale strike price is not below liquidation price
            require(_desiredStrikePrice > cutOff, REASON_MUST_BE_MORE_THAN_CUTOFF);
            buyerSelling = true;
            buyerSaleStrikePrice = _desiredStrikePrice;
            buyerSaleTimeLimit = timeLimit;
        } else if (msg.sender == seller) {
            // check sale strike price is not already above liquidation price
            require(_desiredStrikePrice < cutOff, REASON_MUST_BE_LESS_THAN_CUTOFF);
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
        // calculate cutoff price
        bool isBuyer = (msg.sender == buyer) ? true : false;
        uint cutOff = ContractForDifferenceLibrary.cutOffPrice(
            notionalAmountDai,
            (isBuyer) ? buyerDepositBalance : sellerDepositBalance,
            (isBuyer) ? buyerInitialStrikePrice : sellerInitialStrikePrice,
            isBuyer
        );

        if (msg.sender == buyer) {
            // check new strike price is not below liquidation price
            require(_newPrice > cutOff, REASON_MUST_BE_MORE_THAN_CUTOFF);
            buyerSaleStrikePrice = _newPrice;
        } else if (msg.sender == seller) {
            // check new strike price is not already above liquidation price
            require(_newPrice < cutOff, REASON_MUST_BE_LESS_THAN_CUTOFF);
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
     * @param _value DAI amount
     */
    function buy(bool _buyBuyerSide, uint _value)
        external
        assertBuyPreCond(_buyBuyerSide)
    {
        uint fees = ContractForDifferenceLibrary.joinerFee(notionalAmountDai);
        if (_value <= fees)
            revert(REASON_FEES_NOT_ENOUGH);

        // check sent collateral falls in the allowable range
        uint collateralSent = _value.sub(fees);
        if (!ContractForDifferenceLibrary.collateralInRange(notionalAmountDai, collateralSent))
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

        // move ownership of sent DAI to the CFD
        daiClaim(_value);
        daiTransferToFees(fees);

        // transfer to selling party
        address sellingParty = _buyBuyerSide ? buyer : seller;
        uint sellingPartyCollateral = buyTransferFunds(
            _buyBuyerSide,
            newStrikePrice,
            sellingParty
        );

        // set new party and balances
        uint remainingPartyDeposits = registry.getDAI().
            balanceOf(address(this)).sub(collateralSent);

        // new notional amount value
        uint newNotional = ContractForDifferenceLibrary.calculateNewNotional(
            notionalAmountDai,
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
        notionalAmountDai = newNotional;

        clearSale(_buyBuyerSide);

        // clean up upgradeCalledBy if the departing party had set that
        if (upgradeCalledBy == sellingParty) {
            upgradeCalledBy = address(0);
        }

        ContractForDifferenceRegistry(cfdRegistryAddr).registerParty(msg.sender);
        emit LogCFDSold(msg.sender, sellingParty, newNotional, sellingPartyCollateral, _value, market);
    }

    /* NOTE: Split off into modifier to work around 'stack too deep' error */
    modifier assertBuyPreCond(bool _buyBuyerSide) 
    {
        require(isActive(), REASON_MUST_BE_ACTIVE);
        require(isSelling(_buyBuyerSide ? buyer : seller), REASON_MUST_BE_ON_SALE);
        require(isContractParty(msg.sender) == false, REASON_MUST_NOT_BE_PARTY);
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
            notionalAmountDai,
            buyBuyerSide ? buyerDepositBalance : sellerDepositBalance,
            buyBuyerSide
        );

        // send money to selling party
        daiTransfer(sellingParty, sellingPartyCollateral);
        emit LogCFDTransferFunds(sellingParty, sellingPartyCollateral);
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
            notionalAmountDai,
            buyerDepositBalance,
            strikePrice,
            true
        );

        // if buyer cutoff still in range then buyer wins, otherwise seller
        bool winnerIsBuyer = marketPrice > buyerCutOff;
        address winner = winnerIsBuyer ? buyer : seller;

        // winner takes all
        uint remaining = registry.getDAI().balanceOf(address(this));
        daiTransfer(winner, remaining);
        emit LogCFDTransferFunds(winner, remaining);

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
            notionalAmountDai,
            buyerDepositBalance,
            true
        );
        uint sellerCollateral = ContractForDifferenceLibrary.calculateCollateralAmount(
            strikePrice,
            marketPrice,
            notionalAmountDai,
            sellerDepositBalance,
            false
        );

        //
        // calculate and check the remainder - it should be equal to zero
        //
        // if not expected log the event and transfer the remainder to fees - it
        //     will be sorted out manually
        //
        uint balanceRemainder = registry.getDAI().
            balanceOf(address(this)).
            sub(buyerCollateral).
            sub(sellerCollateral);
        if (balanceRemainder != 0) {
            emit LogCFDRemainingBalanceUnexpected(balanceRemainder);
        }
        daiTransferToFees(balanceRemainder);

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
        daiTransfer(buyer, buyerCollateral);
        emit LogCFDTransferFunds(buyer, buyerCollateral);
        daiTransfer(seller, sellerCollateral);
        emit LogCFDTransferFunds(seller, sellerCollateral);

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
        pre_cond(registry.allCFDs(address(this)) != registry.getCFDFactoryLatest(), REASON_UPGRADE_ALREADY_LATEST)
    {
        // 1st call to initiate upgrade process
        if (upgradeCalledBy == address(0)) {
            upgradeCalledBy = msg.sender;
            return;
        }

        // if here then then this is the 2nd call, invoked by the opposite, so
        // kick off the upgrade process
        upgradeable = true;
        address cfdFactoryLatest = registry.getCFDFactoryLatest();
        address newCfd = address(ContractForDifferenceFactory(cfdFactoryLatest).createByUpgrade());
        daiTransfer(newCfd, registry.getDAI().balanceOf(address(this)));
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
     * Get the latest read for the market of this CFD.
     */
    function latestPrice()
        internal
        view
        returns (uint price)
    {
        price = PriceFeeds(feedsAddr).read(market);
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
            notionalAmountDai,
            _buyerDepositBalance,
            _strikePrice,
            true
        );
        uint sellerCutOff = ContractForDifferenceLibrary.cutOffPrice(
            notionalAmountDai,
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
     * @param _notionalAmountDai Contract notional amount
     * @param _depositBalance Balance of deposits for one party
     *
     * @return cut off price
     */
    function cutOffPrice(
        uint _notionalAmountDai,
        uint _depositBalance,
        uint _strikePrice,
        bool _calcForBuyerSide
    )
        public
        pure
        returns (uint price)
    {
        price = ContractForDifferenceLibrary.cutOffPrice(
            _notionalAmountDai,
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
    function changeInDai(
        uint _strikePrice,
        uint _currentPrice,
        uint _notionalAmount
    )
        public
        pure
        returns (uint change)
    {
        change = ContractForDifferenceLibrary.changeInDai(
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

    /**
     * Transfer DAI to an address.
     */
    function daiTransfer(address _to, uint _value) private {
        require(
            registry.getDAI().transfer(_to, _value),
            REASON_DAI_TRANSFER_FAILED
        );
    }

    /**
     * Transfer DAI to the fees address.
     */
    function daiTransferToFees(uint _value) private {
        daiTransfer(registry.getFees(), _value);
    }

    /**
     * Claim DAI - ie. move approved DAI to this CFD contract.
     */
    function daiClaim(uint _value) private {
        require(
            registry.getDAI().transferFrom(msg.sender, address(this), _value),
            REASON_DAI_TRANSFER_FAILED
        );
    }

}
