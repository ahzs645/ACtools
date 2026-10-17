import { Gunzip, Unzip, UnzipInflate, strFromU8 } from "fflate";
import { validateInterfaceCapture } from "./interface-capture.mjs";
/** Bounded JSON/gzip/update-ZIP reader shared by the extension, viewer and CLI. */
export function readInterfaceArchive(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length > 50 * 1024 * 1024)
    throw new Error("Archive must be smaller than 50 MB.");
  let decoded = bytes;
  if (bytes[0] === 80 && bytes[1] === 75) {
    // Extract only the contract. Vendor assets stay inert and aren't expanded
    // or executed by the viewer. Stream bounds also cover forged ZIP sizes.
    const chunks = []; let length = 0; let found = false; let complete = false;
    const unzip = new Unzip(file => {
      if (file.name !== 'interface.json.gz') return;
      if (found) throw new Error('Update bundle has duplicate interface contracts.');
      found = true;
      file.ondata = (error, chunk, final) => {
        if (error) throw error;
        length += chunk.length;
        if (length > 50 * 1024 * 1024) throw new Error('Bundled contract exceeds 50 MB.');
        chunks.push(chunk); complete = final;
      };
      file.start();
    });
    unzip.register(UnzipInflate);
    for (let offset=0;offset<bytes.length;offset+=65536)
      unzip.push(bytes.subarray(offset,offset+65536),offset+65536>=bytes.length);
    if (!found || !complete) throw new Error('Update bundle is missing interface.json.gz.');
    decoded = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { decoded.set(chunk,offset); offset+=chunk.length; }
  }
  if (decoded[0] === 31 && decoded[1] === 139) {
    const compressed = decoded;
    const chunks = [];
    let length = 0;
    const gunzip = new Gunzip((chunk) => {
      length += chunk.length;
      if (length > 128 * 1024 * 1024)
        throw new Error("Expanded archive exceeds 128 MB.");
      chunks.push(chunk);
    });
    for (let offset = 0; offset < compressed.length; offset += 65536)
      gunzip.push(
        compressed.subarray(offset, offset + 65536),
        offset + 65536 >= compressed.length,
      );
    decoded = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      decoded.set(chunk, offset);
      offset += chunk.length;
    }
  }
  return validateInterfaceCapture(JSON.parse(strFromU8(decoded)));
}
