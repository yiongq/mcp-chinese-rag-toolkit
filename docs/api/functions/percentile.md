[**@yiong/mcp-chinese-rag-toolkit**](../README.md)

***

[@yiong/mcp-chinese-rag-toolkit](../README.md) / percentile

# Function: percentile()

> **percentile**(`samples`, `p`): `number`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/latency-harness.ts:64](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/rag/latency-harness.ts#L64)

NIST type 7 linear-interpolation percentile (the same algorithm NumPy
`np.quantile(..., method='linear')` and SciPy `scoreatpercentile` default
to). Exposed so other bench tooling can share the math.

Formula: `h = (n - 1) * p; result = data[floor(h)] + (h - floor(h)) *
(data[floor(h) + 1] - data[floor(h)])`. For `p === 1` the result is the
last sample; for `p === 0` the first.

## Parameters

### samples

`number`[]

### p

`number`

## Returns

`number`

## Throws

if `samples` is empty.

## Throws

if `p` is not a finite number in `[0, 1]`.
