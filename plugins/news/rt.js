import { createRssCommand } from './_rssbase.js'

export default createRssCommand({
    name: 'rt',
    aliases: ['rt-news'],
    description: 'RT News',
    feed: 'https://www.rt.com/rss/news/',
})
