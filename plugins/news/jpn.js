import { createRssCommand } from './_rssbase.js'

export default createRssCommand({
    name: 'jpn',
    aliases: ['jpnnews', 'japantimes'],
    description: 'Japan News',
    feed: 'https://www.japantimes.co.jp/feed/',
})
