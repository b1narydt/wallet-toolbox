import {
  CachedKeyDeriver,
  Hash,
  PrivateKey,
  PublicKey,
  Script,
  Spend,
  Transaction,
  TransactionSignature,
  UnlockingScript
} from '@bsv/sdk'
import { ScriptTemplateBRC29 } from '../../src/utility/ScriptTemplateBRC29'
import { StandardSigningProvider } from '../../src/signer/StandardSigningProvider'
import { Wallet } from '../../src/Wallet'
import { WalletSigner } from '../../src/signer/WalletSigner'

describe('StandardSigningProvider', () => {
  const rootKey = PrivateKey.fromHex('1'.repeat(64))
  const keyDeriver = new CachedKeyDeriver(rootKey)
  const identityKey = rootKey.toPublicKey().toString()
  const derivationPrefix = 'dGVzdHByZWZpeA=='
  const derivationSuffix = 'dGVzdHN1ZmZpeA=='
  const provider = new StandardSigningProvider(keyDeriver)

  test('identityPublicKey returns the root public key', () => {
    expect(provider.identityPublicKey().toString()).toBe(identityKey)
  })

  test('deriveChangeLockingScript is byte-identical to ScriptTemplateBRC29.lock', async () => {
    const sabppp = new ScriptTemplateBRC29({ derivationPrefix, derivationSuffix, keyDeriver })
    const expected = sabppp.lock(rootKey.toHex(), identityKey).toBinary()
    const actual = await provider.deriveChangeLockingScript(derivationPrefix, derivationSuffix)
    expect(actual).toEqual(expected)
  })

  test('signInput produces a complete unlocking script that Spend.validate accepts', async () => {
    const lockingScript = Script.fromBinary(
      await provider.deriveChangeLockingScript(derivationPrefix, derivationSuffix)
    )
    const sourceTx = new Transaction()
    sourceTx.addOutput({ lockingScript, satoshis: 1000 })
    const sourceTXID = sourceTx.id('hex') as string

    const tx = new Transaction()
    tx.addInput({
      sourceTXID,
      sourceOutputIndex: 0,
      unlockingScript: new Script(),
      sequence: 0xffffffff
    })
    tx.addOutput({ lockingScript: new Script(), satoshis: 900 })

    const scope = TransactionSignature.SIGHASH_ALL | TransactionSignature.SIGHASH_FORKID
    const preimage = TransactionSignature.format({
      sourceTXID,
      sourceOutputIndex: 0,
      sourceSatoshis: 1000,
      transactionVersion: tx.version,
      otherInputs: [],
      inputIndex: 0,
      outputs: tx.outputs,
      inputSequence: 0xffffffff,
      subscript: lockingScript,
      lockTime: tx.lockTime,
      scope
    })
    const sighash = Hash.hash256(preimage)

    const unlockBin = await provider.signInput(
      sighash,
      scope,
      derivationPrefix,
      derivationSuffix,
      PublicKey.fromString(identityKey)
    )

    const spend = new Spend({
      sourceTXID,
      sourceOutputIndex: 0,
      sourceSatoshis: 1000,
      lockingScript,
      transactionVersion: tx.version,
      otherInputs: [],
      inputIndex: 0,
      unlockingScript: UnlockingScript.fromBinary(unlockBin),
      inputSequence: 0xffffffff,
      outputs: tx.outputs,
      lockTime: tx.lockTime
    })
    expect(spend.validate()).toBe(true)
  })

  test('signInput rejects a non-32-byte sighash', async () => {
    await expect(
      provider.signInput([1, 2, 3], 0x41, derivationPrefix, derivationSuffix, PublicKey.fromString(identityKey))
    ).rejects.toThrow('32 bytes')
  })
})

describe('signingProvider threading', () => {
  const rootKey = PrivateKey.fromHex('1'.repeat(64))
  const keyDeriver = new CachedKeyDeriver(rootKey)
  const identityKey = rootKey.toPublicKey().toString()
  const provider = new StandardSigningProvider(keyDeriver)
  // Wallet's ctor only checks storage._authId.identityKey and (if services
  // are given) calls setServices — a minimal stub satisfies it.
  const stubStorage = { _authId: { identityKey }, setServices: () => {} } as any

  test('WalletSigner carries the provider into Wallet', () => {
    const signer = new WalletSigner('test', keyDeriver as any, stubStorage, provider)
    const wallet = new Wallet(signer)
    expect(wallet.signingProvider).toBe(provider)
  })

  test('provider is optional and defaults to undefined', () => {
    const signer = new WalletSigner('test', keyDeriver as any, stubStorage)
    const wallet = new Wallet(signer)
    expect(wallet.signingProvider).toBeUndefined()
  })
})
