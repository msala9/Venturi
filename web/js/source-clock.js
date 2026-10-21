export function sourceSampleAtFrame(frame,fps) {
  if(!Number.isSafeInteger(frame) || frame<0 || ![fps?.num,fps?.den].every(value=>Number.isSafeInteger(value) && value>0 && value<=2_147_483_647))throw new Error("Invalid Source frame or frame rate");
  const num=BigInt(fps.num),den=BigInt(fps.den);
  const sample=(BigInt(frame)*den*48_000n+num/2n)/num;
  if(sample>BigInt(Number.MAX_SAFE_INTEGER))throw new Error("Source audio position exceeds its safe range");
  return Number(sample);
}
