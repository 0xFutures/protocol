import program from 'commander'
import {readFileSync, writeFileSync} from 'fs'

let inABIFile, outABIFile

program
  .arguments('<inputABIFile> <outputABIFile')
  .action((inFile, outFile) => {
    inABIFile = inFile
    outABIFile = outFile
  })
  .parse(process.argv)

const inABI = JSON.parse(readFileSync(inABIFile))
delete inABI.ast
delete inABI.legacyAST
writeFileSync(outABIFile, JSON.stringify(inABI, null, 2))
