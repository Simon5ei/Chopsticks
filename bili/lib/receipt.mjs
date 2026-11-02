import fs from 'node:fs';

// Private artifact, never parsed from external text or console output.
export function confirmReceipt(kind, id, url) {
  if (!/^[1-9][0-9]{0,19}$/.test(String(id))) throw new Error('Bili response has no confirmed publishing identifier');
  const receipt={status:'confirmed',kind,id:String(id),url};
  if (process.env.CHOPSTICKS_BILI_RECEIPT) fs.writeFileSync(process.env.CHOPSTICKS_BILI_RECEIPT,JSON.stringify(receipt),{flag:'wx',mode:0o600});
  console.log('CHOPSTICKS_BILI_RECEIPT '+JSON.stringify(receipt));
  return receipt;
}
