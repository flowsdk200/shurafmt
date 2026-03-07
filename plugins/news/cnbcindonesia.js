import { createRssCommand } from './_rssbase.js'

export default createRssCommand({
    name: 'cnbcindonesia',
    aliases: ['cnbcid'],
    description: 'CNBC Indonesia',
    feed: 'https://www.cnbcindonesia.com/news/rss',
})
