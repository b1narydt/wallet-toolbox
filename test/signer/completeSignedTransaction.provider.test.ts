import { CachedKeyDeriver, PrivateKey, PublicKey, Script, Transaction } from '@bsv/sdk'
import { PendingSignAction, PendingStorageInput, Wallet } from '../../src/Wallet'
import { completeSignedTransaction, verifyUnlockScripts } from '../../src/signer/methods/completeSignedTransaction'
import { SigningProvider } from '../../src/signer/SigningProvider'
import { StandardSigningProvider } from '../../src/signer/StandardSigningProvider'

const rootKey = PrivateKey.fromHex('1'.repeat(64))
const keyDeriver = new CachedKeyDeriver(rootKey)
const identityKey = rootKey.toPublicKey().toString()
const derivationPrefix = 'dGVzdHByZWZpeA=='
const derivationSuffix = 'dGVzdHN1ZmZpeA=='

/** Minimal Wallet stand-in: completeSignedTransaction reads only these. */
function stubWallet(signingProvider?: SigningProvider): Wallet {
  return {
    keyDeriver,
    signingProvider,
    getClientChangeKeyPair: () => ({ privateKey: rootKey.toHex(), publicKey: identityKey })
  } as unknown as Wallet
}

/** Fresh funding tx + spending tx + pdi describing the single BRC-29 input. */
async function buildPrior(): Promise<{ prior: PendingSignAction; lockingScript: Script; sourceTXID: string }> {
  const provider = new StandardSigningProvider(keyDeriver)
  const lockingScript = Script.fromBinary(await provider.deriveChangeLockingScript(derivationPrefix, derivationSuffix))
  const sourceTx = new Transaction()
  sourceTx.addOutput({ lockingScript, satoshis: 5000 })
  const sourceTXID = sourceTx.id('hex') as string

  const tx = new Transaction()
  tx.addInput({
    sourceTXID,
    sourceOutputIndex: 0,
    sourceTransaction: sourceTx,
    unlockingScript: new Script(),
    sequence: 0xffffffff
  })
  tx.addOutput({ lockingScript: new Script(), satoshis: 4900 })

  const pdi: PendingStorageInput[] = [
    {
      vin: 0,
      derivationPrefix,
      derivationSuffix,
      sourceSatoshis: 5000,
      lockingScript: lockingScript.toHex()
    }
  ]
  const prior = {
    reference: 'test',
    dcr: {} as any,
    args: { inputs: [] } as any,
    tx,
    amount: 5000,
    pdi
  } as PendingSignAction
  return { prior, lockingScript, sourceTXID }
}

describe('completeSignedTransaction with a SigningProvider', () => {
  test('provider path and legacy path produce byte-identical transactions', async () => {
    const a = await buildPrior()
    const b = await buildPrior()
    const legacy = await completeSignedTransaction(a.prior, {}, stubWallet())
    const viaProvider = await completeSignedTransaction(b.prior, {}, stubWallet(new StandardSigningProvider(keyDeriver)))
    expect(viaProvider.toHex()).toBe(legacy.toHex())
  })

  test('prepareSpendContexts runs once, before signInput; signature validates', async () => {
    const calls: string[] = []
    const inner = new StandardSigningProvider(keyDeriver)
    const spy: SigningProvider = {
      identityPublicKey: () => inner.identityPublicKey(),
      deriveChangeLockingScript: (p, s) => inner.deriveChangeLockingScript(p, s),
      prepareSpendContexts: async (tx, pending) => {
        calls.push(`prepare:${pending.length}`)
      },
      signInput: async (sighash, sighashType, p, s, u) => {
        calls.push(`sign:${sighash.length}`)
        return inner.signInput(sighash, sighashType, p, s, u)
      }
    }
    const { prior } = await buildPrior()
    const tx = await completeSignedTransaction(prior, {}, stubWallet(spy))
    expect(calls).toEqual(['prepare:1', 'sign:32'])
    expect(tx.inputs[0].unlockingScript!.toBinary().length).toBeGreaterThan(0)
  })

  test('a rejecting provider aborts the action with input context', async () => {
    const failing: SigningProvider = {
      identityPublicKey: () => PublicKey.fromString(identityKey),
      deriveChangeLockingScript: async () => [],
      signInput: async () => {
        throw new Error('cosigner offline')
      }
    }
    const { prior } = await buildPrior()
    await expect(completeSignedTransaction(prior, {}, stubWallet(failing))).rejects.toThrow(/input 0.*cosigner offline/s)
  })
})
