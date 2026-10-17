import {readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

// CRC32C validates the actual wire payload at each receiving service.
const table=Uint32Array.from({length:256},(_,n)=>{
  for(let i=0;i<8;i++)n=(n&1)?(n>>>1)^0x82f63b78:n>>>1;
  return n>>>0;
});
export function crc32c(bytes){
  let crc=0xffffffff;
  for(const byte of bytes)crc=(crc>>>8)^table[(crc^byte)&255];
  return ((crc^0xffffffff)>>>0).toString(16).padStart(8,'0');
}
export function prepareManifest(folder){
  const file=path.join(folder,'manifest.json');
  const manifest=JSON.parse(readFileSync(file,'utf8'));
  for(const item of manifest)for(const f of item.files){
    assert.equal(path.basename(f.name),f.name);
    const bytes=readFileSync(path.join(folder,f.name));
    assert.equal(bytes.length,f.length);
    f.crc32c=crc32c(bytes);
  }
  writeFileSync(file,JSON.stringify(manifest,null,2));
  return manifest;
}
