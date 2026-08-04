import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import ts from 'typescript'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outRoot = path.join(os.tmpdir(), 'easysolution-domain-tests')

const files = [
  'src/domain/fiscalYear.ts',
  'src/companyContext.ts',
  'src/domain/accountingPolicy.ts',
  'src/domain/allocations.ts',
  'src/domain/validation.ts',
  'src/domain/lifecycle.ts',
  'src/domain/chartOfAccounts.ts',
  'src/domain/ledger.ts',
  'src/domain/reconciliation.ts',
  'src/application/draftAutosave.ts',
  'src/application/paymentAllocationUi.ts',
  'src/application/purchaseFormValidation.ts',
  'src/application/reportFilters.ts',
  'src/application/transactionActions.ts',
  'src/purchase/calculations.ts',
  'src/stock/settings.ts',
  'src/stock/services/stockCalculations.ts',
  'src/stock/services/stockCarryForward.ts',
  'src/stock/services/stockDocuments.ts',
  'src/stock/services/stockLandedCost.ts',
  'src/stock/services/stockLedger.ts',
  'src/stock/services/stockTransactions.ts',
  'tests/domain.test.ts',
]

const rewriteImports = (source) =>
  source.replace(/(from\s+['"])(\.{1,2}\/[^'"]+?)(\.ts)?(['"])/g, (_match, prefix, specifier, _ext, suffix) => {
    if (specifier.endsWith('.mjs') || specifier.endsWith('.json') || specifier.endsWith('.css')) {
      return `${prefix}${specifier}${suffix}`
    }
    return `${prefix}${specifier}.mjs${suffix}`
  })

await rm(outRoot, { recursive: true, force: true })

for (const file of files) {
  const inputPath = path.join(root, file)
  const outputPath = path.join(outRoot, file.replace(/\.ts$/, '.mjs'))
  const source = await readFile(inputPath, 'utf8')
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      verbatimModuleSyntax: true,
    },
    fileName: inputPath,
  }).outputText

  await mkdir(path.dirname(outputPath), { recursive: true })
  await writeFile(outputPath, rewriteImports(transpiled), 'utf8')
}

const testFile = path.join(outRoot, 'tests/domain.test.mjs')
const result = spawnSync(process.execPath, ['--test', testFile], {
  cwd: root,
  stdio: 'inherit',
})

process.exit(result.status ?? 1)
