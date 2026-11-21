import "server-only";
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const s3 = new S3Client({
  endpoint: process.env.S3_ENDPOINT,
  region: process.env.S3_REGION,
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID!,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
  },
});

const Bucket = process.env.S3_BUCKET!;

export async function putObject(key: string, body: Buffer, contentType: string) {
  await s3.send(new PutObjectCommand({ Bucket, Key: key, Body: body, ContentType: contentType }));
}

export async function getObjectText(key: string): Promise<string> {
  const res = await s3.send(new GetObjectCommand({ Bucket, Key: key }));
  return res.Body!.transformToString();
}

export async function deleteObjects(keys: string[]) {
  if (!keys.length) return;
  await s3.send(
    new DeleteObjectsCommand({ Bucket, Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true } })
  );
}

export function signedDownloadUrl(key: string, expiresInSeconds = 3600) {
  return getSignedUrl(s3, new GetObjectCommand({ Bucket, Key: key }), { expiresIn: expiresInSeconds });
}
