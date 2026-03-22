import { createRssCommand } from './_rssbase.js'

export default createRssCommand({
    name: 'cnet',
    aliases: ['cnet-news'],
    description: 'CNET News',
    feed: 'https://www.cnet.com/rss/news/',
})
