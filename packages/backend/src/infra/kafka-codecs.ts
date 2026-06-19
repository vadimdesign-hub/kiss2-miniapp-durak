/**
 * ZSTD codec registration for kafkajs.
 *
 * kafkajs ships only gzip out of the box. Platform topics like
 * `userOnlineRecord.created` are produced with ZSTD compression and the
 * consumer crashes with `KafkaJSNotImplemented: ZSTD compression not
 * implemented` if no codec is registered.
 *
 * We use Node 22+ built-in node:zlib zstd APIs — no native dependencies,
 * works on node:alpine without python3/make/g++.
 *
 * Side-effect import in consumer.ts (above consumer.run()) is enough —
 * `CompressionCodecs` is a global module-level map inside kafkajs.
 */
import { promisify } from "node:util";
import { zstdCompress, zstdDecompress } from "node:zlib";

import kafkajs from "kafkajs";

// CompressionCodecs / CompressionTypes are not picked up as named exports by
// Node's cjs-module-lexer (kafkajs accesses them via member-access internally),
// so we destructure from the default import.
const { CompressionCodecs, CompressionTypes } = kafkajs;

const compress = promisify(zstdCompress);
const decompress = promisify(zstdDecompress);

CompressionCodecs[CompressionTypes.ZSTD] = () => ({
	async compress(encoder: { buffer: Buffer }): Promise<Buffer> {
		return compress(encoder.buffer);
	},
	async decompress(buffer: Buffer): Promise<Buffer> {
		return decompress(buffer);
	},
});
