import { Image, Page, StyleSheet, Text, View } from '@react-pdf/renderer'
import type { ReactNode } from 'react'
import octaraaLogo from '../assets/octaraa-logo.png'
import type { FlagSeverity } from '../lib/types'
import { pdfColors } from './theme'

const styles = StyleSheet.create({
  page: {
    paddingTop: 78,
    paddingBottom: 56,
    paddingHorizontal: 40,
    fontFamily: 'Figtree',
    fontSize: 9.5,
    color: pdfColors.body,
  },
  headerFixed: {
    position: 'absolute',
    top: 24,
    left: 40,
    right: 40,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  logoImg: { width: 62, height: 19 },
  headerRight: { alignItems: 'flex-end' },
  headerClient: { fontFamily: 'Lexend', fontSize: 10, fontWeight: 600, color: pdfColors.ink },
  headerMeta: { fontSize: 7.5, color: pdfColors.muted, marginTop: 2 },
  headerDivider: { height: 2, backgroundColor: pdfColors.secondary, marginTop: 8 },
  footerFixed: {
    position: 'absolute',
    bottom: 24,
    left: 40,
    right: 40,
  },
  footerDivider: { height: 0.75, backgroundColor: pdfColors.border, marginBottom: 6 },
  footerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  footerLeft: { flexDirection: 'row', alignItems: 'center' },
  footerLogo: { width: 32, height: 10, marginRight: 5 },
  footerText: { fontSize: 6.5, color: pdfColors.faint },
})

export function ReportPage({
  clientName,
  planDate,
  children,
}: {
  clientName: string
  planDate: string
  children: ReactNode
}) {
  return (
    <Page size="A4" style={styles.page} wrap>
      <View style={styles.headerFixed} fixed>
        <View style={styles.headerRow}>
          <Image src={octaraaLogo} style={styles.logoImg} />
          <View style={styles.headerRight}>
            <Text style={styles.headerClient}>{clientName || 'Draft Will'}</Text>
            <Text
              style={styles.headerMeta}
              render={({ pageNumber, totalPages }) =>
                `PLAN DATE: ${planDate} · PAGE ${Math.max(pageNumber - 1, 1)} OF ${Math.max(totalPages - 1, 1)}`
              }
            />
          </View>
        </View>
        <View style={styles.headerDivider} />
      </View>

      {children}

      <View style={styles.footerFixed} fixed>
        <View style={styles.footerDivider} />
        <View style={styles.footerRow}>
          <View style={styles.footerLeft}>
            <Image src={octaraaLogo} style={styles.footerLogo} />
            <Text style={styles.footerText}>Octaraa — Strictly Confidential</Text>
          </View>
          <Text style={styles.footerText}>Draft only — not a substitute for a signed, witnessed original</Text>
        </View>
      </View>
    </Page>
  )
}

const secStyles = StyleSheet.create({
  title: {
    fontFamily: 'Lexend',
    fontSize: 13,
    fontWeight: 600,
    color: pdfColors.ink,
    marginBottom: 6,
  },
  divider: { height: 1.5, backgroundColor: pdfColors.secondary, marginBottom: 12 },
  block: { marginBottom: 20 },
})

// Not wrap={false}: section content (tables, flag lists, the full draft
// text) can run longer than one page depending on how much the user filled
// in, and must be able to flow onto continuation pages. Individual rows/
// cards within (DataTable, FlagCard, GroupedAssetTable) opt out of
// splitting themselves instead, so a row is never sliced mid-way.
export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={secStyles.block}>
      <Text style={secStyles.title}>{title}</Text>
      <View style={secStyles.divider} />
      {children}
    </View>
  )
}

const statStyles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 10, marginBottom: 20 },
  card: {
    flex: 1,
    borderRadius: 6,
    padding: 12,
    borderWidth: 1,
    borderColor: pdfColors.border,
  },
  cardFilled: { backgroundColor: pdfColors.primary, borderColor: pdfColors.primary },
  cardAccent: { borderColor: pdfColors.secondary, borderWidth: 1.5 },
  label: { fontSize: 7, letterSpacing: 0.5, color: pdfColors.muted, marginBottom: 4 },
  labelOnDark: { fontSize: 7, letterSpacing: 0.5, color: '#c7cdfa', marginBottom: 4 },
  value: { fontFamily: 'Lexend', fontSize: 17, fontWeight: 700, color: pdfColors.ink },
  valueOnDark: { fontFamily: 'Lexend', fontSize: 17, fontWeight: 700, color: pdfColors.white },
  valueAccent: { color: pdfColors.secondary },
  caption: { fontSize: 7, color: pdfColors.muted, marginTop: 3 },
  captionOnDark: { fontSize: 7, color: '#c7cdfa', marginTop: 3 },
})

export interface StatCardDef {
  label: string
  value: string
  caption?: string
  variant?: 'default' | 'filled' | 'accent'
}

export function StatCardRow({ cards }: { cards: StatCardDef[] }) {
  return (
    <View style={statStyles.row}>
      {cards.map((c, i) => {
        const filled = c.variant === 'filled'
        const accent = c.variant === 'accent'
        return (
          <View
            key={i}
            style={[
              statStyles.card,
              filled ? statStyles.cardFilled : undefined,
              accent ? statStyles.cardAccent : undefined,
            ]}
          >
            <Text style={filled ? statStyles.labelOnDark : statStyles.label}>{c.label}</Text>
            <Text
              style={[filled ? statStyles.valueOnDark : statStyles.value, accent ? statStyles.valueAccent : undefined]}
            >
              {c.value}
            </Text>
            {c.caption && <Text style={filled ? statStyles.captionOnDark : statStyles.caption}>{c.caption}</Text>}
          </View>
        )
      })}
    </View>
  )
}

const gridStyles = StyleSheet.create({
  box: {
    borderWidth: 1,
    borderColor: pdfColors.border,
    borderRadius: 6,
    padding: 12,
  },
  row: { flexDirection: 'row', marginBottom: 8 },
  cell: { flex: 1, paddingRight: 8 },
  label: { fontSize: 7, letterSpacing: 0.4, color: pdfColors.muted, marginBottom: 2 },
  value: { fontSize: 9.5, color: pdfColors.ink, fontWeight: 600 },
})

export function InfoGrid({ rows }: { rows: { label: string; value: string }[][] }) {
  return (
    <View style={gridStyles.box}>
      {rows.map((row, i) => (
        <View key={i} style={[gridStyles.row, i === rows.length - 1 ? { marginBottom: 0 } : undefined]}>
          {row.map((f, j) => (
            <View key={j} style={gridStyles.cell}>
              <Text style={gridStyles.label}>{f.label.toUpperCase()}</Text>
              <Text style={gridStyles.value}>{f.value || '—'}</Text>
            </View>
          ))}
        </View>
      ))}
    </View>
  )
}

const flagPalette: Record<FlagSeverity, { bg: string; border: string; accent: string; label: string }> = {
  critical: { bg: pdfColors.criticalBg, border: pdfColors.criticalBorder, accent: pdfColors.critical, label: 'NEEDS LEGAL REVIEW' },
  warning: { bg: pdfColors.warningBg, border: pdfColors.warningBorder, accent: pdfColors.warning, label: 'WORTH CLARIFYING' },
  info: { bg: pdfColors.infoBg, border: pdfColors.infoBorder, accent: pdfColors.info, label: 'GOOD TO KNOW' },
}

const flagStyles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    borderWidth: 1,
    borderRadius: 5,
    padding: 10,
    marginBottom: 8,
  },
  bar: { width: 3, borderRadius: 2, marginRight: 9 },
  body: { flex: 1 },
  pill: {
    alignSelf: 'flex-start',
    fontSize: 6,
    letterSpacing: 0.4,
    fontWeight: 600,
    paddingVertical: 2,
    paddingHorizontal: 6,
    borderRadius: 8,
    marginBottom: 4,
  },
  title: { fontSize: 9.5, fontWeight: 700, color: pdfColors.ink, marginBottom: 2 },
  desc: { fontSize: 8.5, color: pdfColors.body, lineHeight: 1.4 },
})

export function FlagCard({ severity, title, description }: { severity: FlagSeverity; title: string; description: string }) {
  const palette = flagPalette[severity]
  return (
    <View style={[flagStyles.card, { backgroundColor: palette.bg, borderColor: palette.border }]} wrap={false}>
      <View style={[flagStyles.bar, { backgroundColor: palette.accent }]} />
      <View style={flagStyles.body}>
        <Text style={[flagStyles.pill, { backgroundColor: palette.accent, color: pdfColors.white }]}>{palette.label}</Text>
        <Text style={flagStyles.title}>{title}</Text>
        <Text style={flagStyles.desc}>{description}</Text>
      </View>
    </View>
  )
}

const tableStyles = StyleSheet.create({
  table: { borderWidth: 1, borderColor: pdfColors.border, borderRadius: 4, overflow: 'hidden', marginBottom: 4 },
  headRow: { flexDirection: 'row', backgroundColor: pdfColors.primary },
  headCell: { padding: 6, fontSize: 7, letterSpacing: 0.4, color: pdfColors.white, fontWeight: 600 },
  groupRow: { flexDirection: 'row', backgroundColor: pdfColors.panel, borderTopWidth: 1, borderTopColor: pdfColors.border },
  groupCell: { padding: 6, fontSize: 7.5, letterSpacing: 0.3, color: pdfColors.muted, fontWeight: 700 },
  bodyRow: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: pdfColors.border },
  bodyCell: { padding: 6, fontSize: 8.5, color: pdfColors.body },
  totalRow: { flexDirection: 'row', backgroundColor: pdfColors.primary, borderTopWidth: 1, borderTopColor: pdfColors.primary },
  totalCell: { padding: 6, fontSize: 8.5, color: pdfColors.white, fontWeight: 700 },
})

export interface TableColumn {
  key: string
  label: string
  width: number
}

export function DataTable({
  columns,
  rows,
  totalLabel,
}: {
  columns: TableColumn[]
  rows: Record<string, string>[]
  totalLabel?: string
}) {
  return (
    <View style={tableStyles.table}>
      <View style={tableStyles.headRow}>
        {columns.map((c) => (
          <Text key={c.key} style={[tableStyles.headCell, { width: `${c.width}%` }]}>
            {c.label.toUpperCase()}
          </Text>
        ))}
      </View>
      {rows.length === 0 ? (
        <View style={tableStyles.bodyRow}>
          <Text style={[tableStyles.bodyCell, { width: '100%', fontStyle: 'italic', color: pdfColors.faint }]}>
            None provided.
          </Text>
        </View>
      ) : (
        rows.map((row, i) => (
          <View key={i} style={tableStyles.bodyRow} wrap={false}>
            {columns.map((c) => (
              <Text key={c.key} style={[tableStyles.bodyCell, { width: `${c.width}%` }]}>
                {row[c.key] || '—'}
              </Text>
            ))}
          </View>
        ))
      )}
      {totalLabel && rows.length > 0 && (
        <View style={tableStyles.totalRow}>
          <Text style={[tableStyles.totalCell, { width: '100%' }]}>{totalLabel}</Text>
        </View>
      )}
    </View>
  )
}

function TableGroupHeading({ children }: { children: ReactNode }) {
  return (
    <View style={tableStyles.groupRow}>
      <Text style={[tableStyles.groupCell, { width: '100%' }]}>{children}</Text>
    </View>
  )
}

export interface AssetGroup {
  label: string
  rows: { primary: string; secondary: string }[]
}

export function GroupedAssetTable({ groups }: { groups: AssetGroup[] }) {
  const totalItems = groups.reduce((sum, g) => sum + g.rows.length, 0)
  const nonEmptyGroups = groups.filter((g) => g.rows.length > 0)

  return (
    <View style={tableStyles.table}>
      <View style={tableStyles.headRow}>
        <Text style={[tableStyles.headCell, { width: '65%' }]}>ITEM</Text>
        <Text style={[tableStyles.headCell, { width: '35%' }]}>REFERENCE / DETAILS</Text>
      </View>
      {nonEmptyGroups.length === 0 ? (
        <View style={tableStyles.bodyRow}>
          <Text style={[tableStyles.bodyCell, { width: '100%', fontStyle: 'italic', color: pdfColors.faint }]}>
            No assets listed yet.
          </Text>
        </View>
      ) : (
        nonEmptyGroups.map((group) => (
          <View key={group.label}>
            {/* Heading stays glued to its first row so it's never left orphaned at a
                page break, but later rows in a long group are free to flow to the
                next page individually instead of dragging the whole group along. */}
            <View wrap={false}>
              <TableGroupHeading>
                {group.label.toUpperCase()} — {group.rows.length} ITEM{group.rows.length === 1 ? '' : 'S'}
              </TableGroupHeading>
              <View style={tableStyles.bodyRow}>
                <Text style={[tableStyles.bodyCell, { width: '65%' }]}>{group.rows[0].primary || '—'}</Text>
                <Text style={[tableStyles.bodyCell, { width: '35%' }]}>{group.rows[0].secondary || '—'}</Text>
              </View>
            </View>
            {group.rows.slice(1).map((row, i) => (
              <View key={i} style={tableStyles.bodyRow} wrap={false}>
                <Text style={[tableStyles.bodyCell, { width: '65%' }]}>{row.primary || '—'}</Text>
                <Text style={[tableStyles.bodyCell, { width: '35%' }]}>{row.secondary || '—'}</Text>
              </View>
            ))}
          </View>
        ))
      )}
      {totalItems > 0 && (
        <View style={tableStyles.totalRow}>
          <Text style={[tableStyles.totalCell, { width: '100%' }]}>
            Total Asset Entries: {totalItems}
          </Text>
        </View>
      )}
    </View>
  )
}

const calloutStyles = StyleSheet.create({
  box: { borderWidth: 1, borderRadius: 5, padding: 10, marginBottom: 10 },
  text: { fontSize: 8.5, lineHeight: 1.45 },
})

export function PdfCallout({ tone, children }: { tone: FlagSeverity; children: ReactNode }) {
  const palette = flagPalette[tone]
  return (
    <View style={[calloutStyles.box, { backgroundColor: palette.bg, borderColor: palette.border }]}>
      <Text style={[calloutStyles.text, { color: pdfColors.body }]}>{children}</Text>
    </View>
  )
}
