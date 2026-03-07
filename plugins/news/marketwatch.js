import { createRssCommand } from './_rssbase.js'

export default createRssCommand({
    name: 'marketwatch',
    aliases: [],
    description: 'MarketWatch',
    feed: 'https://feeds.marketwatch.com/marketwatch/topstories/',
})
