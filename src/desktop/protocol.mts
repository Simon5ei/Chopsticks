/** Drop desktop MCP discovery/initialize guides; preserve tool schemas/results. */
export function filterServerMessage(line?: any){
 if(!line.includes('"instructions"')||!line.includes('serverInfo'))return line;
 try{
  const message=JSON.parse(line),result=message?.result;
  const identity=result?.serverInfo??result?._meta?.['io.modelcontextprotocol/serverInfo'];
  if(message?.jsonrpc==='2.0'&&identity?.name==='computer-use-linux'&&result.capabilities&&!Object.hasOwn(result,'content')&&Object.hasOwn(result,'instructions')){
   delete result.instructions;return JSON.stringify(message);
  }
 }catch{}
 return line;
}
