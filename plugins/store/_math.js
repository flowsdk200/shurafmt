const normalizeNumber = (value) => {
    const raw = String(value || '').trim()
    if (!raw) return NaN

    if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(raw)) {
        return Number.parseFloat(raw.replace(/\./g, '').replace(',', '.'))
    }

    if (/^\d+,\d+$/.test(raw)) {
        return Number.parseFloat(raw.replace(',', '.'))
    }

    return Number.parseFloat(raw)
}

const formatNumber = (value) => {
    const num = Number(value)
    if (!Number.isFinite(num)) return '-'

    return new Intl.NumberFormat('id-ID', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 6
    }).format(num)
}

const row = (label, value) => ` • ${label.padEnd(5, ' ')} : ${value}`

const parseExpression = (text = '', operators = []) => {
    const raw = String(text || '').trim()
    if (!raw) return []

    const escaped = operators
        .map((op) => op.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .sort((a, b) => b.length - a.length)
    const splitter = new RegExp(`\\s*(?:${escaped.join('|')})\\s*`, 'g')

    return raw
        .split(splitter)
        .map(normalizeNumber)
        .filter((num) => Number.isFinite(num))
}

const buildUsage = (prefix, command, example) =>
    `Contoh penggunaan:\n- ${prefix + command} ${example}`

const buildResultText = ({ title, symbol, values, result }) => {
    const detail =
        `${row('Input', values.map(formatNumber).join(` ${symbol} `))}\n` +
        `${row('Hasil', formatNumber(result))}`

    return (
        `${title}\n\n` +
        `  \`PERHITUNGAN:\`\n` +
        `\`\`\`${detail}\`\`\``
    )
}

const tokenizeMathExpression = (text = '') => {
    const raw = String(text || '')
        .replace(/[xX×]/g, '*')
        .replace(/\s+/g, '')

    if (!raw || /[^0-9.,+\-*/]/.test(raw)) return null

    const matches = raw.match(/\d+(?:[.,]\d+)?|[+\-*/]/g)
    if (!matches?.length) return null

    const tokens = []
    for (const token of matches) {
        if (/^[+\-*/]$/.test(token)) {
            tokens.push(token)
            continue
        }

        const value = normalizeNumber(token)
        if (!Number.isFinite(value)) return null
        tokens.push(value)
    }

    if (typeof tokens[0] !== 'number' || typeof tokens[tokens.length - 1] !== 'number') return null
    for (let i = 1; i < tokens.length; i += 2) {
        if (typeof tokens[i] !== 'string' || typeof tokens[i + 1] !== 'number') return null
    }

    return tokens
}

const evaluateMathExpression = (text = '') => {
    const tokens = tokenizeMathExpression(text)
    if (!tokens) return null

    const values = [tokens[0]]
    const ops = []
    const precedence = { '+': 1, '-': 1, '*': 2, '/': 2 }

    const applyTop = () => {
        const op = ops.pop()
        const b = values.pop()
        const a = values.pop()
        if (!Number.isFinite(a) || !Number.isFinite(b)) return false
        if (op === '+') values.push(a + b)
        else if (op === '-') values.push(a - b)
        else if (op === '*') values.push(a * b)
        else if (op === '/') {
            if (b === 0) return false
            values.push(a / b)
        }
        return true
    }

    for (let i = 1; i < tokens.length; i += 2) {
        const op = tokens[i]
        const value = tokens[i + 1]
        while (ops.length && precedence[ops[ops.length - 1]] >= precedence[op]) {
            if (!applyTop()) return null
        }
        ops.push(op)
        values.push(value)
    }

    while (ops.length) {
        if (!applyTop()) return null
    }

    return {
        tokens,
        result: values[0]
    }
}

const buildSingleResultText = ({ title, rows = [] }) => (
    `${title}\n\n` +
    `  \`PERHITUNGAN:\`\n` +
    `\`\`\`${rows.join('\n')}\`\`\``
)

export {
    buildSingleResultText,
    buildResultText,
    buildUsage,
    evaluateMathExpression,
    formatNumber,
    parseExpression
}
