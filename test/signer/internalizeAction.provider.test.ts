import { Beef, CachedKeyDeriver, InternalizeActionArgs, P2PKH, PrivateKey, Script, Transaction } from '@bsv/sdk'
import { Wallet } from '../../src/Wallet'
import { internalizeAction } from '../../src/signer/methods/internalizeAction'
import { StandardSigningProvider } from '../../src/signer/StandardSigningProvider'
import { brc29ProtocolID } from '../../src/utility/ScriptTemplateBRC29'
import { computeMerklePath } from '../../src/mockchain/merkleTree'
import { AuthId, StorageInternalizeActionResult } from '../../src/sdk/WalletStorage.interfaces'

const receiverRootKey = PrivateKey.fromHex('1'.repeat(64))
const receiverKeyDeriver = new CachedKeyDeriver(receiverRootKey)
const receiverIdentityKey = receiverRootKey.toPublicKey().toString()

const senderRootKey = PrivateKey.fromHex('2'.repeat(64))
const senderKeyDeriver = new CachedKeyDeriver(senderRootKey)
const senderIdentityKey = senderRootKey.toPublicKey().toString()

const derivationPrefix = 'cHJlZml4QQ=='
const derivationSuffix = 'c3VmZml4QQ=='
const keyID = `${derivationPrefix} ${derivationSuffix}`

const auth: AuthId = { identityKey: receiverIdentityKey }

/** The exact legacy expected script: internalizeAction.ts's historical derivePrivateKey path. */
function legacyExpectedScript (): Script {
  const privKey = receiverKeyDeriver.derivePrivateKey(brc29ProtocolID, keyID, senderIdentityKey)
  return new P2PKH().lock(privKey.toAddress())
}

/** The script the SENDER computes when locking the payment to the receiver (BRC-42, forSelf=false). */
function senderSideScript (): Script {
  const childPub = senderKeyDeriver.derivePublicKey(brc29ProtocolID, keyID, receiverIdentityKey, false)
  return new P2PKH().lock(childPub.toAddress())
}

/**
 * Minimal AtomicBEEF fixture per the design (§4.2): tx1 (funding) carries a
 * single-tx BUMP whose root the stub chainTracker accepts; tx2 spends tx1 and
 * pays one output locked to the sender-derived BRC-29 child script.
 */
function makeFixture (paymentLockingScript: Script): { args: InternalizeActionArgs, paymentTxid: string } {
  const fundingTx = new Transaction()
  fundingTx.addOutput({ lockingScript: new P2PKH().lock(senderRootKey.toAddress()), satoshis: 2000 })
  fundingTx.merklePath = computeMerklePath([fundingTx.id('hex')], 0, 850000)

  const paymentTx = new Transaction()
  paymentTx.addInput({
    sourceTransaction: fundingTx,
    sourceOutputIndex: 0,
    unlockingScript: new Script(),
    sequence: 0xffffffff
  })
  paymentTx.addOutput({ lockingScript: paymentLockingScript, satoshis: 1000 })

  const beef = new Beef()
  beef.mergeTransaction(paymentTx)

  const args: InternalizeActionArgs = {
    tx: beef.toBinaryAtomic(paymentTx.id('hex')),
    outputs: [
      {
        outputIndex: 0,
        protocol: 'wallet payment',
        paymentRemittance: { derivationPrefix, derivationSuffix, senderIdentityKey }
      }
    ],
    description: 'internalize wallet payment (provider seam test)'
  }
  return { args, paymentTxid: paymentTx.id('hex') }
}

const storageResultStub = {
  accepted: true,
  isMerge: false,
  txid: 'stub',
  satoshis: 1000
} as unknown as StorageInternalizeActionResult

/** Fake Wallet per the existing test/signer pattern (`as unknown as Wallet`). */
function makeWallet (keyDeriver: unknown, signingProvider: unknown): { wallet: Wallet, storageCalls: InternalizeActionArgs[] } {
  const storageCalls: InternalizeActionArgs[] = []
  const wallet = {
    keyDeriver,
    signingProvider,
    getServices: () => ({
      getChainTracker: async () => ({ isValidRootForHeight: async () => true })
    }),
    storage: {
      internalizeAction: async (a: InternalizeActionArgs) => {
        storageCalls.push(a)
        return storageResultStub
      }
    }
  } as unknown as Wallet
  return { wallet, storageCalls }
}

/** KeyDeriver that throws on any derivation — mirrors the desktop VaultKeyDeriver tripwire. */
function poisonedKeyDeriver (): unknown {
  return {
    derivePrivateKey: () => {
      throw new Error('POISONED: derivePrivateKey must not be called in provider mode')
    },
    derivePublicKey: () => {
      throw new Error('POISONED: derivePublicKey must not be called in provider mode')
    }
  }
}

describe('§4.1 provider equivalence (pure)', () => {
  test('StandardSigningProvider.deriveWalletPaymentLockingScript equals the legacy derivePrivateKey path', async () => {
    const provider = new StandardSigningProvider(receiverKeyDeriver)
    const actual = await provider.deriveWalletPaymentLockingScript!(derivationPrefix, derivationSuffix, senderIdentityKey)
    expect(actual).toEqual(legacyExpectedScript().toBinary())
  })

  test('sender-side derivation (forSelf=false, counterparty=receiver) produces the same script — BRC-42 symmetry', async () => {
    const provider = new StandardSigningProvider(receiverKeyDeriver)
    const actual = await provider.deriveWalletPaymentLockingScript!(derivationPrefix, derivationSuffix, senderIdentityKey)
    expect(actual).toEqual(senderSideScript().toBinary())
    // and the legacy receiver path agrees with the sender path (the invariant real payments rely on)
    expect(legacyExpectedScript().toBinary()).toEqual(senderSideScript().toBinary())
  })
})

describe('§4.2 provider mode: hook called, keyDeriver untouched', () => {
  test('valid payment resolves via the provider; poisoned keyDeriver never invoked; storage gets original args', async () => {
    const { args } = makeFixture(senderSideScript())
    const hookCalls: Array<[string, string, string]> = []
    const provider = {
      deriveWalletPaymentLockingScript: async (prefix: string, suffix: string, sender: string) => {
        hookCalls.push([prefix, suffix, sender])
        return legacyExpectedScript().toBinary()
      }
    }
    const { wallet, storageCalls } = makeWallet(poisonedKeyDeriver(), provider)

    const r = await internalizeAction(wallet, auth, args)

    expect(r).toBe(storageResultStub)
    expect(hookCalls).toEqual([[derivationPrefix, derivationSuffix, senderIdentityKey]])
    expect(storageCalls).toHaveLength(1)
    expect(storageCalls[0]).toBe(args)
  })

  test('provider mode rejects a tampered lockingScript (fail-closed)', async () => {
    const wrongScript = new P2PKH().lock(PrivateKey.fromHex('3'.repeat(64)).toAddress())
    const { args } = makeFixture(wrongScript)
    const provider = {
      deriveWalletPaymentLockingScript: async () => legacyExpectedScript().toBinary()
    }
    const { wallet, storageCalls } = makeWallet(poisonedKeyDeriver(), provider)

    await expect(internalizeAction(wallet, auth, args)).rejects.toThrow('BRC-29')
    expect(storageCalls).toHaveLength(0)
  })
})

describe('§4.3 legacy mode: byte-identical behavior', () => {
  test('no provider: valid payment accepted via the real keyDeriver (derivePrivateKey) path', async () => {
    const { args } = makeFixture(senderSideScript())
    let derivePrivateKeyCalls = 0
    const spiedKeyDeriver = {
      derivePrivateKey: (protocol: unknown, kid: string, counterparty: string) => {
        derivePrivateKeyCalls++
        return receiverKeyDeriver.derivePrivateKey(protocol as typeof brc29ProtocolID, kid, counterparty)
      }
    }
    const { wallet, storageCalls } = makeWallet(spiedKeyDeriver, undefined)

    const r = await internalizeAction(wallet, auth, args)

    expect(r).toBe(storageResultStub)
    expect(derivePrivateKeyCalls).toBe(1)
    expect(storageCalls).toHaveLength(1)
  })

  test('provider WITHOUT the optional method: falls back to the legacy keyDeriver path unchanged', async () => {
    const { args } = makeFixture(senderSideScript())
    let derivePrivateKeyCalls = 0
    const spiedKeyDeriver = {
      derivePrivateKey: (protocol: unknown, kid: string, counterparty: string) => {
        derivePrivateKeyCalls++
        return receiverKeyDeriver.derivePrivateKey(protocol as typeof brc29ProtocolID, kid, counterparty)
      }
    }
    // a provider object lacking deriveWalletPaymentLockingScript (e.g. pre-seam implementations)
    const methodlessProvider = {
      deriveChangeLockingScript: async () => {
        throw new Error('must not be called by internalizeAction')
      }
    }
    const { wallet, storageCalls } = makeWallet(spiedKeyDeriver, methodlessProvider)

    const r = await internalizeAction(wallet, auth, args)

    expect(r).toBe(storageResultStub)
    expect(derivePrivateKeyCalls).toBe(1)
    expect(storageCalls).toHaveLength(1)
  })

  test('no provider: tampered lockingScript rejected with WERR_INVALID_PARAMETER (paymentRemittance/BRC-29)', async () => {
    const wrongScript = new P2PKH().lock(PrivateKey.fromHex('3'.repeat(64)).toAddress())
    const { args } = makeFixture(wrongScript)
    const { wallet, storageCalls } = makeWallet(receiverKeyDeriver, undefined)

    await expect(internalizeAction(wallet, auth, args)).rejects.toThrow(
      expect.objectContaining({ name: 'WERR_INVALID_PARAMETER', message: expect.stringContaining('BRC-29') })
    )
    expect(storageCalls).toHaveLength(0)
  })
})
