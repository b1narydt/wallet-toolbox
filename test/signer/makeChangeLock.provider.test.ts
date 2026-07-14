import { CachedKeyDeriver, PrivateKey, Script } from '@bsv/sdk'
import { Wallet } from '../../src/Wallet'
import { makeChangeLock } from '../../src/signer/methods/buildSignableTransaction'
import { StandardSigningProvider } from '../../src/signer/StandardSigningProvider'
import { ScriptTemplateBRC29 } from '../../src/utility/ScriptTemplateBRC29'

const rootKey = PrivateKey.fromHex('1'.repeat(64))
const keyDeriver = new CachedKeyDeriver(rootKey)
const identityKey = rootKey.toPublicKey().toString()
const derivationPrefix = 'cHJlZml4QQ=='
const derivationSuffix = 'c3VmZml4QQ=='

const out = { derivationSuffix } as any
const dctr = { derivationPrefix } as any
const args = {} as any

describe('makeChangeLock with a SigningProvider', () => {
  test('no provider: byte-identical to the historical ScriptTemplateBRC29 path', async () => {
    const wallet = {
      keyDeriver,
      signingProvider: undefined,
      getClientChangeKeyPair: () => ({ privateKey: rootKey.toHex(), publicKey: identityKey })
    } as unknown as Wallet
    const sabppp = new ScriptTemplateBRC29({ derivationPrefix, derivationSuffix, keyDeriver })
    const expected = sabppp.lock(rootKey.toHex(), identityKey).toBinary()
    const actual = await makeChangeLock(out, dctr, args, wallet)
    expect(actual.toBinary()).toEqual(expected)
  })

  test('provider set: uses the provider and never touches getClientChangeKeyPair', async () => {
    const provider = new StandardSigningProvider(keyDeriver)
    const wallet = {
      keyDeriver,
      signingProvider: provider,
      getClientChangeKeyPair: () => {
        throw new Error('root key must not be materialized in provider mode')
      }
    } as unknown as Wallet
    const expected = await provider.deriveChangeLockingScript(derivationPrefix, derivationSuffix)
    const actual = await makeChangeLock(out, dctr, args, wallet)
    expect(actual.toBinary()).toEqual(expected)
  })
})
