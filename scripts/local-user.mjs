#!/usr/bin/env node
import { readFileSync, mkdirSync, writeFileSync, chmodSync } from 'node:fs';
import { resolve } from 'node:path';
import { hashPassword, validateUsers } from '../src/lib/server/runtime/auth.js';
const [id,role='admin']=process.argv.slice(2);
if (!/^[a-z][a-z0-9_-]{2,63}$/.test(id??'') || !['admin','editor','viewer'].includes(role)) {
  console.error('Usage: VAS_BOOTSTRAP_PASSWORD=<password> npm run auth:user -- <user-id> [admin|editor|viewer]');process.exit(1);
}
const password=process.env.VAS_BOOTSTRAP_PASSWORD;
if (!password) {console.error('Set VAS_BOOTSTRAP_PASSWORD (do not put the password in command arguments)');process.exit(1);}
const file=resolve(process.cwd(),'.vas/users.local.json');
let users=[];
try {users=validateUsers(JSON.parse(readFileSync(file,'utf8')));} catch(error) {if(error.code!=='ENOENT') {console.error('Existing users file is invalid; refusing to overwrite');process.exit(1);}}
const next={id,role,passwordHash:hashPassword(password)};
users=users.filter(x=>x.id!==id);users.push(next);validateUsers(users);
mkdirSync(resolve(process.cwd(),'.vas'),{recursive:true,mode:0o700});
writeFileSync(file,JSON.stringify(users,null,2)+'\n',{mode:0o600});chmodSync(file,0o600);
console.log(`Local ${role} user ${id} configured. Restart the development server to apply user changes.`);
