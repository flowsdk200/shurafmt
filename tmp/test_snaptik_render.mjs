import { load } from 'cheerio'
import vm from 'node:vm'

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

const sandbox = {
  globalThis: {},
  window: { location: { hostname: 'snaptik.app' } },
  document: {},
  console: { log() {} },
  $: () => ({ remove() {}, style: {}, innerHTML: '' }),
  gtag() {}
}
vm.runInNewContext(js.replace('eval(function', 'globalThis.__decoded=(function'), sandbox, { timeout: 5000 })
const decoded = String(sandbox.globalThis.__decoded || '')
const renderToken = (decoded.match(/data-token=\\"([^\\"]+)/) || [])[1] || ''
console.log('renderTokenLen', renderToken.length)
const renderRes = await fetch(`https://snaptik.app/render.php?token=${encodeURIComponent(renderToken)}`, {
  headers: { 'user-agent': 'Mozilla/5.0', referer: 'https://snaptik.app/en2' }
})
console.log('render status', renderRes.status)
const renderJson = await renderRes.json()
console.log('render json', JSON.stringify(renderJson))
if (!renderJson.task_id) process.exit(0)
for (let i = 0; i < 8; i++) {
  const res = await fetch(`https://snaptik.app/task.php?token=${encodeURIComponent(renderJson.task_id)}`, {
    headers: { 'user-agent': 'Mozilla/5.0', referer: 'https://snaptik.app/en2' }
  })
  const obj = await res.json()
  console.log('poll', i, JSON.stringify(obj))
  if (obj.download_url || obj.status !== 0 || obj.progress === 100) break
  await new Promise(resolve => setTimeout(resolve, 3000))
}
