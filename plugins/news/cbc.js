import { createRssCommand } from './_rssbase.js'

export default createRssCommand({
    name: 'cbc',
    aliases: ['cbc-news'],
    description: 'CBC News',
    feed: 'https://www.cbc.ca/cmlink/rss-world',
})
