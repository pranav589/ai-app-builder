import { describe, expect, it, vi } from "vitest"
import sodium from "libsodium-wrappers"
import * as githubApi from "@/lib/github/api"
import { upsertRepoSecret } from "../github-secrets"

describe("github-secrets", () => {
  it("fetches repo public key, seals secret with libsodium, and puts to GitHub", async () => {
    await sodium.ready
    const keyPair = sodium.crypto_box_keypair()
    const publicKeyBase64 = sodium.to_base64(keyPair.publicKey, sodium.base64_variants.ORIGINAL)

    const getPublicKeySpy = vi
      .spyOn(githubApi, "getActionsPublicKey")
      .mockResolvedValue({ key_id: "key_123", key: publicKeyBase64 })

    let capturedEncryptedValue = ""
    let capturedKeyId = ""
    const putSecretSpy = vi
      .spyOn(githubApi, "createOrUpdateRepoSecret")
      .mockImplementation(async (_token, _owner, _repo, _secretName, encVal, keyId) => {
        capturedEncryptedValue = encVal
        capturedKeyId = keyId
      })

    const secretValue = "expo_pat_super_secret"
    await upsertRepoSecret("gh_token", "owner", "repo", "EXPO_TOKEN", secretValue)

    expect(getPublicKeySpy).toHaveBeenCalledWith("gh_token", "owner", "repo")
    expect(putSecretSpy).toHaveBeenCalled()
    expect(capturedKeyId).toBe("key_123")
    expect(capturedEncryptedValue).toBeTruthy()

    // Verify libsodium can decrypt the sealed box using the private key
    const ciphertext = sodium.from_base64(capturedEncryptedValue, sodium.base64_variants.ORIGINAL)
    const decrypted = sodium.crypto_box_seal_open(ciphertext, keyPair.publicKey, keyPair.privateKey)
    expect(sodium.to_string(decrypted)).toBe(secretValue)
  })
})
