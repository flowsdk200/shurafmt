import { createRssCommand } from './_rssbase.js'

export default createRssCommand({
    name: 'cnnindonesia',
    aliases: ['cnnid'],
    description: 'CNN Indonesia',
    feed: 'https://www.cnnindonesia.com/rss',
})
