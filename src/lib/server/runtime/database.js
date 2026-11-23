let pool;
let key;
export async function database(env){
  const config={host:env.DB_HOST,port:Number(env.DB_PORT||3306),user:env.DB_USER,password:env.DB_PASSWORD||'',database:env.DB_NAME};
  if(!Number.isInteger(config.port)||config.port<1||config.port>65535)throw new Error('Invalid DB_PORT');
  const next=JSON.stringify(config);
  if(pool&&next===key)return pool;
  if(pool)await pool.end();
  const {createPool}=await import('mysql2/promise');
  pool=createPool({...config,waitForConnections:true,connectionLimit:4,queueLimit:20,enableKeepAlive:true,
    supportBigNumbers:true,bigNumberStrings:true,dateStrings:true,decimalNumbers:false,
    multipleStatements:false,connectTimeout:8000});
  key=next;return pool;
}
