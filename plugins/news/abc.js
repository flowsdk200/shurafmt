import { createRssCommand } from './_rssbase.js'

export default createRssCommand({
    name: 'abc',
    aliases: ['abc-news'],
    description: 'ABC News',
    feed: 'https://www.abc.net.au/news/feed/51120/rss.xml',
})
