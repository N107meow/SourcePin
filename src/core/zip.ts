const encoder = new TextEncoder();
const table = Uint32Array.from({length:256},(_,i)=>{let n=i;for(let bit=0;bit<8;bit++)n=(n>>>1)^((n&1)?0xedb88320:0);return n>>>0;});
function crc32(bytes: Uint8Array): number {let crc=0xffffffff;for(const byte of bytes)crc=(crc>>>8)^table[(crc^byte)&255];return (crc^0xffffffff)>>>0;}
/** Stored ZIP: bounded, deterministic local container; no compression dependency. */
export function createZip(files: Record<string,string>, limit=16*1024*1024): Blob {
 const entries=Object.entries(files).map(([name,text])=>({name:encoder.encode(name),data:encoder.encode(text)}));
 const total=22+entries.reduce((n,e)=>n+76+e.name.length*2+e.data.length,0);
 if(total>limit)throw new Error(`ZIP exceeds ${limit} bytes (${total}); reduce capture range or viewports. No files were exported.`);
 const output=new Uint8Array(total),view=new DataView(output.buffer);let offset=0;
 const central:{entry:typeof entries[number];crc:number;offset:number}[]=[];
 for(const entry of entries){const start=offset,crc=crc32(entry.data);central.push({entry,crc,offset:start});view.setUint32(offset,0x04034b50,true);view.setUint16(offset+4,20,true);view.setUint16(offset+6,0x800,true);view.setUint16(offset+12,0x21,true);view.setUint32(offset+14,crc,true);view.setUint32(offset+18,entry.data.length,true);view.setUint32(offset+22,entry.data.length,true);view.setUint16(offset+26,entry.name.length,true);offset+=30;output.set(entry.name,offset);offset+=entry.name.length;output.set(entry.data,offset);offset+=entry.data.length;}
 const start=offset;
 for(const {entry,crc,offset:local} of central){view.setUint32(offset,0x02014b50,true);view.setUint16(offset+4,20,true);view.setUint16(offset+6,20,true);view.setUint16(offset+8,0x800,true);view.setUint16(offset+14,0x21,true);view.setUint32(offset+16,crc,true);view.setUint32(offset+20,entry.data.length,true);view.setUint32(offset+24,entry.data.length,true);view.setUint16(offset+28,entry.name.length,true);view.setUint32(offset+42,local,true);offset+=46;output.set(entry.name,offset);offset+=entry.name.length;}
 view.setUint32(offset,0x06054b50,true);view.setUint16(offset+8,entries.length,true);view.setUint16(offset+10,entries.length,true);view.setUint32(offset+12,offset-start,true);view.setUint32(offset+16,start,true);
 return new Blob([output],{type:'application/zip'});
}
