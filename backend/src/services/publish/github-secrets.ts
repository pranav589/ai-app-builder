import sodium from "libsodium-wrappers"
import { createOrUpdateRepoSecret, getActionsPublicKey } from "@/lib/github/api"

/**
 * Seals `value` with the repository's Actions public key and updates the secret.
 * GitHub Actions secrets are encrypted using libsodium's crypto_box_seal.
 */
export async function upsertRepoSecret(
  token: string,
  owner: string,
  repo: string,
  name: string,
  value: string
): Promise<void> {
  const { key_id, key } = await getActionsPublicKey(token, owner, repo)

  await sodium.ready
  const binkey = sodium.from_base64(key, sodium.base64_variants.ORIGINAL)
  const binsec = sodium.from_string(value)
  const encBytes = sodium.crypto_box_seal(binsec, binkey)
  const encryptedValue = sodium.to_base64(encBytes, sodium.base64_variants.ORIGINAL)

  await createOrUpdateRepoSecret(token, owner, repo, name, encryptedValue, key_id)
}
