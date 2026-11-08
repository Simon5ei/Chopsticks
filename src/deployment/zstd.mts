import {zstdDecompressSync} from 'node:zlib';
// Node 24 builds differ in whether one sync call consumes concatenated frames.
export function decodeZstdArchive(bytes?: any){
 const chunks=[];let offset=0;
 while(offset<bytes.length){
  const result: any=zstdDecompressSync(bytes.subarray(offset),{info:true});
  const consumed=result.engine.bytesWritten;
  if(!Number.isSafeInteger(consumed)||consumed<=0||consumed>bytes.length-offset)throw Error('Invalid Zstandard frame progress');
  chunks.push(result.buffer);offset+=consumed;
 }
 return Buffer.concat(chunks);
}
