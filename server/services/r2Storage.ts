import fs from 'fs'
import path from 'path'
import { GetObjectCommand, PutObjectCommand, DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

const PREFIX = process.env.R2_PREFIX?.replace(/^\/+|\/+$/g, '') || 'adu-buffer'
const SIGNED_TTL = Number(process.env.R2_SIGNED_URL_TTL_SEC ?? 3600)

let client: S3Client | null = null

function getClient(): S3Client | null {
  const accountId = process.env.R2_ACCOUNT_ID
  const accessKeyId = process.env.R2_ACCESS_KEY_ID
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY
  const bucket = process.env.R2_BUCKET_NAME
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) return null

  if (!client) {
    client = new S3Client({
      region: 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId, secretAccessKey },
    })
  }
  return client
}

export function isR2Enabled(): boolean {
  return getClient() !== null && Boolean(process.env.R2_BUCKET_NAME)
}

function bucketName(): string {
  const bucket = process.env.R2_BUCKET_NAME
  if (!bucket) throw new Error('R2_BUCKET_NAME is not configured')
  return bucket
}

export function buildQueueVideoKey(pageId: string, jobId: string) {
  return `${PREFIX}/${pageId}/${jobId}.mp4`
}

export function buildQueueThumbKey(pageId: string, jobId: string, ext = 'jpg') {
  return `${PREFIX}/${pageId}/${jobId}.${ext}`
}

export async function uploadQueueFile(localPath: string, key: string, contentType: string): Promise<void> {
  const s3 = getClient()
  if (!s3) throw new Error('R2 is not configured')

  const body = fs.readFileSync(localPath)
  await s3.send(
    new PutObjectCommand({
      Bucket: bucketName(),
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  )
}

export async function getSignedPreviewUrl(key: string): Promise<string> {
  const s3 = getClient()
  if (!s3) throw new Error('R2 is not configured')

  return getSignedUrl(
    s3,
    new GetObjectCommand({
      Bucket: bucketName(),
      Key: key,
    }),
    { expiresIn: SIGNED_TTL },
  )
}

export async function downloadQueueFile(key: string, destPath: string): Promise<void> {
  const s3 = getClient()
  if (!s3) throw new Error('R2 is not configured')

  const res = await s3.send(
    new GetObjectCommand({
      Bucket: bucketName(),
      Key: key,
    }),
  )

  const body = res.Body
  if (!body) throw new Error('Empty R2 object')

  fs.mkdirSync(path.dirname(destPath), { recursive: true })
  const chunks: Buffer[] = []
  for await (const chunk of body as AsyncIterable<Uint8Array>) {
    chunks.push(Buffer.from(chunk))
  }
  fs.writeFileSync(destPath, Buffer.concat(chunks))
}

export async function deleteQueueObjects(keys: (string | null | undefined)[]) {
  const s3 = getClient()
  if (!s3) return

  for (const key of keys) {
    if (!key) continue
    try {
      await s3.send(
        new DeleteObjectCommand({
          Bucket: bucketName(),
          Key: key,
        }),
      )
    } catch (err) {
      console.warn('[r2] delete failed:', key, err)
    }
  }
}
