import { ssh, app } from './remote.mjs'

// Discover the build-generated IDs in the deployed artifacts, never from
// local source paths. Supports SSR proxies and extracted RPC handlers.
export async function discoverRpcManifest() {
  const scanner = String.raw`const fs=require('node:fs');const root='.output/server/_ssr/';let source='';for(const name of fs.readdirSync(root))if(name.endsWith('.mjs'))source+=fs.readFileSync(root+name,'utf8')+'\n';const manifest={},ids={};for(const m of source.matchAll(/(?:var|const) (\w+Fn)_createServerFn_handler = createServerRpc\(\{\s*id:\s*"([a-f0-9]+)"/g))ids[m[1]]=m[2];for(const m of source.matchAll(/(?:var|const) (\w+Fn) = createServerFn\(([\s\S]*?)(?=\n(?:var|const|export|import) |$)/g)){const id=m[2].match(/createSsrRpc\("([a-f0-9]+)"\)/)?.[1]||ids[m[1]];if(id)manifest[m[1]]={id,method:m[2].slice(0,200).match(/method:\s*"(GET|POST)"/)?.[1]||'GET'}}console.log(JSON.stringify(manifest));`
  return JSON.parse(
    await ssh(`docker exec -i ${app} node --input-type=commonjs`, scanner),
  )
}
