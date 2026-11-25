/** Signed VAS release provenance. The trusted key is provisioned independently. */
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { dirname } from 'node:path';

const HASH = /^[0-9a-f]{64}$/;
function ensure(ok, message) { if (!ok) throw Error(message); }
export function fingerprint(publicKey) {
  const key=publicKey?.type==='public' ? publicKey : createPublicKey(publicKey);
  ensure(key.asymmetricKeyType==='ed25519','Publisher public key must be Ed25519');
  return createHash('sha256').update(key.export({type:'spki',format:'der'})).digest('hex');
}
export function provenanceStatement(artifact) {
  ensure(artifact?.version===1 && HASH.test(artifact.releaseId) && HASH.test(artifact.digest) && Number.isSafeInteger(artifact.fileCount) && artifact.fileCount>=1,'Invalid release artifact');
  return JSON.stringify(['vas-release-provenance-v1',artifact.releaseId,artifact.digest,artifact.fileCount]);
}
export function signArtifact(artifact,privatePem) {
  const privateKey=createPrivateKey(privatePem);
  ensure(privateKey.asymmetricKeyType==='ed25519','Publisher private key must be Ed25519');
  const pub=createPublicKey(privateKey);
  const message=Buffer.from(provenanceStatement(artifact),'utf8');
  return {version:1,algorithm:'Ed25519',publisherFingerprint:fingerprint(pub),statement:message.toString('utf8'),signature:sign(null,message,privateKey).toString('base64')};
}
export function verifyArtifactSignature(artifact,proof,trustedPublicPem) {
  ensure(proof?.version===1 && proof.algorithm==='Ed25519' && proof.publisherFingerprint===fingerprint(trustedPublicPem),'Release is not signed by the configured publisher');
  const expected=provenanceStatement(artifact);
  ensure(proof.statement===expected,'Release signature statement does not match staged content');
  ensure(typeof proof.signature==='string' && /^[A-Za-z0-9+/]{86}==$/.test(proof.signature),'Invalid release signature encoding');
  ensure(verify(null,Buffer.from(expected,'utf8'),createPublicKey(trustedPublicPem),Buffer.from(proof.signature,'base64')),'Release signature verification failed');
  return proof.publisherFingerprint;
}
export async function generatePublisherKeys({privatePath,publicPath}) {
  ensure(privatePath && publicPath && privatePath!==publicPath,'Distinct publisher key paths required');
  const {privateKey,publicKey}=generateKeyPairSync('ed25519');
  const privatePem=privateKey.export({type:'pkcs8',format:'pem'});
  const publicPem=publicKey.export({type:'spki',format:'pem'});
  await mkdir(dirname(privatePath),{recursive:true,mode:0o700});
  await mkdir(dirname(publicPath),{recursive:true,mode:0o700});
  await writeFile(privatePath,privatePem,{flag:'wx',mode:0o600});
  try {await writeFile(publicPath,publicPem,{flag:'wx',mode:0o644});}
  catch(error) {await rm(privatePath,{force:true});throw error;}
  return {publisherFingerprint:fingerprint(publicKey),privatePath,publicPath};
}
