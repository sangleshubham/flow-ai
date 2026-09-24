// Regenerates src/graph/icons.generated.ts from the AWS Architecture Icons package (ADR 0049).
//
//   1. Download the "Icon package" zip from https://aws.amazon.com/architecture/icons/ and unzip it.
//   2. node packages/illus-render/scripts/aws-icons.ts <unzipped package dir>
//
// Each icon in `@illus/core`'s GRAPH_ICONS maps to one SVG below. The script keeps the drawing only:
// titles, ids and the XML prolog go, rects become paths (so frame tone CSS never repaints an icon
// background), coordinates are rounded, and the one-colour generic icons draw in `currentColor` so they
// follow the theme. Anything that is not plain shapes (scripts, links, styles, images) is refused.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { GRAPH_ICON_NAMES } from '@illus/core'

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../src/graph/icons.generated.ts')

const GENERAL = (name: string) => `Resource-Icons_*/Res_General-Icons/Res_48_Light/Res_${name}_48_Light.svg`
const SERVICE = (name: string) => `Architecture-Service-Icons_*/*/48/Arch_${name}_48.svg`

/** Icon name → file pattern inside the package (`*` matches one path segment). */
const FILES: Record<string, string> = {
  user: GENERAL('User'),
  users: GENERAL('Users'),
  client: GENERAL('Client'),
  mobile: GENERAL('Mobile-client'),
  server: GENERAL('Server'),
  servers: GENERAL('Servers'),
  database: GENERAL('Database'),
  disk: GENERAL('Disk'),
  'cold-storage': GENERAL('Cold-Storage'),
  tape: GENERAL('Tape-storage'),
  document: GENERAL('Document'),
  documents: GENERAL('Documents'),
  folder: GENERAL('Folder'),
  logs: GENERAL('Logs'),
  metrics: GENERAL('Metrics'),
  gear: GENERAL('Gear'),
  application: GENERAL('Generic-Application'),
  stream: GENERAL('Data-Stream'),
  table: GENERAL('Data-Table'),
  firewall: GENERAL('Firewall'),
  shield: GENERAL('Shield'),
  lock: GENERAL('SSL-padlock'),
  credentials: GENERAL('Credentials'),
  token: GENERAL('SAML-token'),
  email: GENERAL('Email'),
  chat: GENERAL('Chat'),
  forums: GENERAL('Forums'),
  internet: GENERAL('Internet'),
  globe: GENERAL('Globe'),
  code: GENERAL('Source-Code'),
  json: GENERAL('JSON-Script'),
  sdk: GENERAL('SDK'),
  git: GENERAL('Git-Repository'),
  programming: GENERAL('Programming-Language'),
  alert: GENERAL('Alert'),
  search: GENERAL('Magnifying-Glass'),
  recover: GENERAL('Recover'),
  toolkit: GENERAL('Toolkit'),
  building: GENERAL('Office-building'),
  question: GENERAL('Question'),
  camera: GENERAL('Camera'),
  multimedia: GENERAL('Multimedia'),
  console: GENERAL('AWS-Management-Console'),
  'aws-lambda': SERVICE('AWS-Lambda'),
  'aws-s3': SERVICE('Amazon-Simple-Storage-Service'),
  'aws-dynamodb': SERVICE('Amazon-DynamoDB'),
  'aws-rds': SERVICE('Amazon-RDS'),
  'aws-aurora': SERVICE('Amazon-Aurora'),
  'aws-elasticache': SERVICE('Amazon-ElastiCache'),
  'aws-memorydb': SERVICE('Amazon-MemoryDB'),
  'aws-documentdb': SERVICE('Amazon-DocumentDB'),
  'aws-keyspaces': SERVICE('Amazon-Keyspaces'),
  'aws-neptune': SERVICE('Amazon-Neptune'),
  'aws-timestream': SERVICE('Amazon-Timestream'),
  'aws-redshift': SERVICE('Amazon-Redshift'),
  'aws-sqs': SERVICE('Amazon-Simple-Queue-Service'),
  'aws-sns': SERVICE('Amazon-Simple-Notification-Service'),
  'aws-kinesis': SERVICE('Amazon-Kinesis-Data-Streams'),
  'aws-msk': SERVICE('Amazon-Managed-Streaming-for-Apache-Kafka'),
  'aws-eventbridge': SERVICE('Amazon-EventBridge'),
  'aws-step-functions': SERVICE('AWS-Step-Functions'),
  'aws-ec2': SERVICE('Amazon-EC2'),
  'aws-ecs': SERVICE('Amazon-Elastic-Container-Service'),
  'aws-eks': SERVICE('Amazon-Elastic-Kubernetes-Service'),
  'aws-fargate': SERVICE('AWS-Fargate'),
  'aws-batch': SERVICE('AWS-Batch'),
  'aws-api-gateway': SERVICE('Amazon-API-Gateway'),
  'aws-cloudfront': SERVICE('Amazon-CloudFront'),
  'aws-elb': SERVICE('Elastic-Load-Balancing'),
  'aws-route53': SERVICE('Amazon-Route-53'),
  'aws-vpc': SERVICE('Amazon-Virtual-Private-Cloud'),
  'aws-iam': SERVICE('AWS-Identity-and-Access-Management'),
  'aws-cognito': SERVICE('Amazon-Cognito'),
  'aws-kms': SERVICE('AWS-Key-Management-Service'),
  'aws-secrets-manager': SERVICE('AWS-Secrets-Manager'),
  'aws-waf': SERVICE('AWS-WAF'),
  'aws-shield': SERVICE('AWS-Shield'),
  'aws-cloudwatch': SERVICE('Amazon-CloudWatch'),
  'aws-athena': SERVICE('Amazon-Athena'),
  'aws-glue': SERVICE('AWS-Glue'),
  'aws-emr': SERVICE('Amazon-EMR'),
  'aws-opensearch': SERVICE('Amazon-OpenSearch-Service'),
  'aws-sagemaker': SERVICE('Amazon-SageMaker'),
  'aws-bedrock': SERVICE('Amazon-Bedrock'),
  'aws-efs': SERVICE('Amazon-EFS'),
  'aws-ebs': SERVICE('Amazon-Elastic-Block-Store'),
}

/** Resolves a pattern whose segments may contain `*` (matching within one directory name). */
function find(root: string, pattern: string): string {
  let dirs = [root]
  for (const seg of pattern.split('/')) {
    const re = new RegExp(`^${seg.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')}$`)
    dirs = dirs.flatMap((d) => {
      try {
        return readdirSync(d).filter((f) => re.test(f)).map((f) => join(d, f))
      } catch {
        return []
      }
    })
  }
  const files = dirs.filter((f) => statSync(f).isFile())
  if (files.length !== 1) throw new Error(`${pattern}: expected one file, found ${files.length}`)
  return files[0]!
}

const ALLOWED_TAGS = new Set(['g', 'path', 'polygon', 'polyline', 'circle', 'ellipse', 'line'])
const ALLOWED_ATTRS = new Set(['d', 'fill', 'fill-rule', 'clip-rule', 'stroke', 'stroke-width', 'points', 'cx', 'cy', 'r', 'rx', 'ry', 'x1', 'x2', 'y1', 'y2', 'transform', 'opacity'])

function clean(svg: string, file: string): { viewBox: string; body: string } {
  const viewBox = /<svg[^>]*\sviewBox="([\d.\s-]+)"/.exec(svg)?.[1]
  if (!viewBox) throw new Error(`${file}: no viewBox`)
  let body = svg
    .replace(/<\?xml[^>]*\?>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/^[\s\S]*?<svg[^>]*>/, '')
    .replace(/<\/svg>\s*$/, '')
    .replace(/<title>[\s\S]*?<\/title>/g, '')
    .replace(/<desc>[\s\S]*?<\/desc>/g, '')
    // <rect x y width height> (AWS uses them only for square backgrounds) → path
    .replace(/<rect\b([^>]*?)\/?>(\s*<\/rect>)?/g, (_m, attrs: string) => {
      const a = (k: string) => Number(new RegExp(`\\s${k}="([\\d.]+)"`).exec(attrs)?.[1] ?? 0)
      const rest = attrs.replace(/\s(x|y|width|height|id)="[^"]*"/g, '')
      return `<path d="M${a('x')} ${a('y')}h${a('width')}v${a('height')}h-${a('width')}z"${rest}/>`
    })
    .replace(/\s(id|class|version|xmlns(:\w+)?)="[^"]*"/g, '')
    .replace(/<(path|polygon|polyline|circle|ellipse|line)\b([^>]*?)>\s*<\/\1>/g, '<$1$2/>')
    .replace(/(\d+\.\d{2})\d+/g, '$1')
    .replace(/>\s+</g, '><')
    .trim()
  for (const m of body.matchAll(/<\/?([a-zA-Z][\w:-]*)([^>]*)>/g)) {
    if (!ALLOWED_TAGS.has(m[1]!)) throw new Error(`${file}: refused <${m[1]}>`)
    for (const attr of m[2]!.matchAll(/\s([\w:-]+)=/g)) if (!ALLOWED_ATTRS.has(attr[1]!)) throw new Error(`${file}: refused attribute ${attr[1]}`)
  }
  const fills = new Set([...body.matchAll(/fill="(#[0-9A-Fa-f]{3,6})"/g)].map((m) => m[1]!.toUpperCase()))
  const mono = fills.size === 1 && /^#2[34]2F3[DE]$/.test([...fills][0]!)
  if (mono) body = body.replace(/fill="#[0-9A-Fa-f]{6}"/g, 'fill="currentColor"')
  return { viewBox, body }
}

function main() {
  const root = process.argv[2]
  if (!root) throw new Error('usage: node scripts/aws-icons.ts <unzipped AWS icon package dir>')
  const missing = GRAPH_ICON_NAMES.filter((n) => !FILES[n])
  const extra = Object.keys(FILES).filter((n) => !(GRAPH_ICON_NAMES as string[]).includes(n))
  if (missing.length || extra.length) throw new Error(`catalog mismatch; missing: ${missing.join(', ')}; extra: ${extra.join(', ')}`)
  const release = readdirSync(root).map((d) => /_(\d{8})$/.exec(d)?.[1]).find(Boolean) ?? 'unknown'
  const entries = GRAPH_ICON_NAMES.map((name) => {
    const file = find(root, FILES[name]!)
    return [name, { ...clean(readFileSync(file, 'utf8'), file), source: relative(root, file) }] as const
  })
  const lines = entries.map(([name, i]) => `  ${JSON.stringify(name)}: { viewBox: ${JSON.stringify(i.viewBox)}, body: ${JSON.stringify(i.body)} }, // ${i.source}`)
  writeFileSync(
    OUT,
    `// Generated by scripts/aws-icons.ts from the AWS Architecture Icons package ${release}
// (https://aws.amazon.com/architecture/icons/; "We allow customers and partners to use these toolkits and
// assets to create architecture diagrams."). Do not edit by hand. ADR 0049.
/* eslint-disable */

export interface IconSvg {
  viewBox: string
  /** Inner SVG markup: plain shapes only, checked by the generator. */
  body: string
}

export const AWS_ICONS_RELEASE = ${JSON.stringify(release)}

export const ICON_SVGS: Record<string, IconSvg> = {
${lines.join('\n')}
}
`,
  )
  console.log(`wrote ${entries.length} icons (${release}) to ${relative(process.cwd(), OUT)}`)
}

main()
