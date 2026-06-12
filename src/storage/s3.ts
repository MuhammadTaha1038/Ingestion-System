import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Readable } from "stream";

export interface S3Config {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

const normalizeEndpoint = (endpoint: string): string => {
  const trimmed = endpoint.trim();
  if (!trimmed) {
    return trimmed;
  }

  if (/^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(trimmed)) {
    return trimmed;
  }

  return `https://${trimmed}`;
};

export const hasS3Config = (config: S3Config): boolean =>
  Boolean(
    config.endpoint &&
      config.bucket &&
      config.accessKeyId &&
      config.secretAccessKey
  );

export const createS3Client = (config: S3Config): S3Client =>
  new S3Client({
    region: config.region || "us-east-1",
    endpoint: normalizeEndpoint(config.endpoint),
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey
    },
    forcePathStyle: true
  });

const streamToString = async (stream: Readable): Promise<string> => {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks).toString("utf-8");
};

const streamToBuffer = async (stream: Readable): Promise<Buffer> => {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks);
};

export const resolveS3Location = (
  path: string,
  defaultBucket: string
): { bucket: string; key: string } => {
  if (path.startsWith("s3://")) {
    const withoutScheme = path.slice("s3://".length);
    const [bucket, ...rest] = withoutScheme.split("/");
    const key = rest.join("/");
    if (!bucket || !key) {
      throw new Error("invalid_s3_path");
    }

    return { bucket, key };
  }

  const key = path.replace(/^\/+/, "");
  if (!defaultBucket || !key) {
    throw new Error("invalid_s3_path");
  }

  return { bucket: defaultBucket, key };
};

export const getObjectText = async (
  client: S3Client,
  bucket: string,
  key: string
): Promise<string> => {
  const buffer = await getObjectBytes(client, bucket, key);
  return buffer.toString("utf-8");
};

export const getObjectBytes = async (
  client: S3Client,
  bucket: string,
  key: string
): Promise<Buffer> => {
  const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const body = response.Body;

  if (!body) {
    return Buffer.alloc(0);
  }

  if (typeof (body as { transformToByteArray?: () => Promise<Uint8Array> }).transformToByteArray === "function") {
    const bytes = await (body as { transformToByteArray: () => Promise<Uint8Array> }).transformToByteArray();
    return Buffer.from(bytes);
  }

  if (typeof (body as { transformToString?: () => Promise<string> }).transformToString === "function") {
    return Buffer.from(await (body as { transformToString: () => Promise<string> }).transformToString(), "utf-8");
  }

  if (body instanceof Readable) {
    return await streamToBuffer(body);
  }

  return Buffer.from(String(body), "utf-8");
};

export const putObjectText = async (
  client: S3Client,
  bucket: string,
  key: string,
  body: string,
  contentType = "text/plain"
): Promise<void> => {
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType
    })
  );
};
