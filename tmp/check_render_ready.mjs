import { load } from 'cheerio'
import vm from 'node:vm'

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

const home = await fetch('https://snaptik.app/en2', { headers: { 'user-agent': 'Mozilla/5.0' } }).then(r => r.text())
const $home = load(home)
const token = $home('input[name="token"]').attr('value')
const body = new URLSearchParams({ url: 'https://vt.tiktok.com/ZSunuSdqn/', lang: 'en2', token })
const js = await fetch('https://snaptik.app/abc2.php', {
  method: 'POST',
  headers: {
    'user-agent': 'Mozilla/5.0',
    referer: 'https://snaptik.app/en2',
    origin: 'https://snaptik.app',
    'x-requested-with': 'XMLHttpRequest',
    'content-type': 'application/x-www-form-urlencoded; charset=UTF-8'
  },
  body
}).then(r => r.text())
const sandbox = { globalThis: {}, window: { location: { hostname: 'snaptik.app' } }, document: {}, console: { log() {} }, $: () => ({ remove() {}, style: {}, innerHTML: '' }), gtag() {} }
vm.runInNewContext(js.replace('eval(function', 'globalThis.__decoded=(function'), sandbox, { timeout: 5000 })
const decoded = String(sandbox.globalThis.__decoded || '')
const renderToken = (decoded.match(/data-token=\\"([^\\"]+)/) || [])[1] || ''
const renderJson = await fetch(`https://snaptik.app/render.php?token=${encodeURIComponent(renderToken)}`, { headers: { 'user-agent': 'Mozilla/5.0', referer: 'https://snaptik.app/en2' } }).then(r => r.json())
console.log('render', JSON.stringify(renderJson))
let downloadUrl = ''
for (let i = 0; i < 6; i++) {
  const obj = await fetch(`https://snaptik.app/task.php?token=${encodeURIComponent(renderJson.task_id)}`, { headers: { 'user-agent': 'Mozilla/5.0', referer: 'https://snaptik.app/en2' } }).then(r => r.json())
  console.log('task', i, JSON.stringify(obj))
  downloadUrl = obj.download_url || downloadUrl
  if (downloadUrl) {
    const check = await fetch(downloadUrl, { method: 'HEAD', headers: { 'user-agent': 'Mozilla/5.0' } })
    console.log('head', i, check.status, check.headers.get('content-type') || '')
    if (check.status === 200) break
  }
  await sleep(3000)
}
console.log('final', downloadUrl)
