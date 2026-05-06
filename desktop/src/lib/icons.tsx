/**
 * Heroicons adapter — same component names + props (`size`, `className`,
 * `style`, `title`) we used with lucide-react, so each consumer just swaps
 * `from 'lucide-react'` → `from '../lib/icons'`.
 *
 * Heroicons accept `className` for sizing (Tailwind w-4 h-4 etc.); we wrap
 * each one to also accept lucide's `size={n}` numeric prop and translate to
 * inline width/height so existing call sites work unchanged.
 *
 * License note: Heroicons is MIT (Tailwind Labs). Safe for commercial use.
 */
import type { ComponentType, SVGProps } from 'react'
import {
  ArrowLeftIcon, ArrowPathIcon, ArrowRightIcon, ArrowDownTrayIcon,
  Bars3Icon, Bars3CenterLeftIcon, Bars3BottomLeftIcon,
  BoltIcon, BookmarkIcon, BookOpenIcon,
  CalculatorIcon, CalendarDaysIcon, ChartBarIcon, ChatBubbleLeftEllipsisIcon,
  CheckIcon, ChevronDoubleLeftIcon, ChevronDoubleRightIcon, ChevronDownIcon,
  ChevronRightIcon, ChevronUpIcon, CircleStackIcon, ClipboardDocumentIcon,
  ClockIcon, CodeBracketIcon, CodeBracketSquareIcon, Cog6ToothIcon, CpuChipIcon,
  DocumentDuplicateIcon, DocumentIcon, DocumentTextIcon,
  EllipsisHorizontalIcon, EllipsisVerticalIcon, EyeIcon, FaceSmileIcon,
  FolderIcon, FolderOpenIcon, GlobeAltIcon, InboxIcon,
  InformationCircleIcon, KeyIcon, LinkIcon, ListBulletIcon, MagnifyingGlassIcon,
  MoonIcon, MinusIcon, PaintBrushIcon, PaperClipIcon, PencilIcon,
  PhotoIcon, PlayIcon, PlusIcon, QueueListIcon, ShareIcon, Squares2X2Icon,
  SparklesIcon, StopIcon, SunIcon, TableCellsIcon, TagIcon, TrashIcon,
  ViewColumnsIcon, XMarkIcon,
} from '@heroicons/react/24/outline'

type HeroIcon = ComponentType<SVGProps<SVGSVGElement> & { title?: string }>

type Props = {
  size?: number
  className?: string
  style?: React.CSSProperties
  title?: string
}

function wrap(Comp: HeroIcon, defaultStrokeWidth = 1.6) {
  return function Icon({ size = 16, className, style, title }: Props) {
    return (
      <Comp
        aria-label={title}
        title={title}
        className={className}
        style={{
          width:  size,
          height: size,
          strokeWidth: defaultStrokeWidth,
          flexShrink: 0,
          ...style,
        }}
      />
    )
  }
}

// ── Hand-rolled letter icons for B / I / U / S formatting buttons.
// Heroicons doesn't ship dedicated rich-text glyphs; SVG <text> is the
// simplest way to keep the bubble-menu visually consistent with the rest. ─
function letterIcon(letter: string, opts: { weight?: number; italic?: boolean; decoration?: string } = {}): HeroIcon {
  const { weight = 700, italic = false, decoration = '' } = opts
  // eslint-disable-next-line react/display-name
  return ((props: SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" fill="none" {...props}>
      <text
        x="50%" y="70%" textAnchor="middle"
        fontSize="18"
        fontFamily="ui-sans-serif, system-ui, -apple-system"
        fontWeight={weight}
        fontStyle={italic ? 'italic' : undefined}
        textDecoration={decoration || undefined}
        fill="currentColor"
      >{letter}</text>
    </svg>
  )) as HeroIcon
}

const BoldGlyph          = letterIcon('B', { weight: 800 })
const ItalicGlyph        = letterIcon('I', { weight: 600, italic: true })
const UnderlineGlyph     = letterIcon('U', { weight: 600, decoration: 'underline' })
const StrikethroughGlyph = letterIcon('S', { weight: 600, decoration: 'line-through' })

/* ────────── Direct equivalents ─────────────────────────────────────── */

export const Plus            = wrap(PlusIcon)
export const ChevronRight    = wrap(ChevronRightIcon)
export const ChevronDown     = wrap(ChevronDownIcon)
export const ArrowLeft       = wrap(ArrowLeftIcon)
export const ArrowRight      = wrap(ArrowRightIcon)
export const Check           = wrap(CheckIcon)
export const X               = wrap(XMarkIcon)
export const Search          = wrap(MagnifyingGlassIcon)
export const Sun             = wrap(SunIcon)
export const Moon            = wrap(MoonIcon)
export const Calendar        = wrap(CalendarDaysIcon)
export const Folder          = wrap(FolderIcon)
export const Globe           = wrap(GlobeAltIcon)
export const Sparkles        = wrap(SparklesIcon)
export const Settings        = wrap(Cog6ToothIcon)
export const Activity        = wrap(BoltIcon)
export const Bookmark        = wrap(BookmarkIcon)
export const Tag             = wrap(TagIcon)
export const Inbox           = wrap(InboxIcon)
export const Clock           = wrap(ClockIcon)
export const Trash2          = wrap(TrashIcon)
export const Link2           = wrap(LinkIcon)
export const Eye             = wrap(EyeIcon)
export const Key             = wrap(KeyIcon)
export const Save            = wrap(ArrowDownTrayIcon)
export const FileCode        = wrap(CodeBracketSquareIcon)
export const Play            = wrap(PlayIcon)

/* ────────── Renames (lucide → closest Heroicon) ──────────────────── */

export const Database        = wrap(CircleStackIcon)
export const FileText        = wrap(DocumentTextIcon)
export const Cpu             = wrap(CpuChipIcon)
export const Edit3           = wrap(PencilIcon)
export const FolderInput     = wrap(FolderOpenIcon)
export const MoreHorizontal  = wrap(EllipsisHorizontalIcon)
export const RefreshCw       = wrap(ArrowPathIcon)
export const ListTree        = wrap(QueueListIcon)
export const Network         = wrap(ShareIcon)
export const Square          = wrap(StopIcon)
export const GripVertical    = wrap(EllipsisVerticalIcon)
export const Sidebar         = wrap(Bars3CenterLeftIcon)
export const SidebarOpen     = wrap(Bars3BottomLeftIcon)
export const PanelLeftClose  = wrap(ChevronDoubleLeftIcon)
export const PanelLeftOpen   = wrap(ChevronDoubleRightIcon)
export const PanelRight      = wrap(ViewColumnsIcon)
export const PanelRightClose = wrap(ChevronDoubleRightIcon)
export const PanelRightOpen  = wrap(ChevronDoubleLeftIcon)
export const Squares2X2      = wrap(Squares2X2Icon)

/* ────────── Slash menu / formatting / blocks ─────────────────────── */

export const Type            = wrap(DocumentIcon)
export const Heading1        = wrap(BookOpenIcon)
export const Heading2        = wrap(BookOpenIcon)
export const Heading3        = wrap(BookOpenIcon)
export const List            = wrap(ListBulletIcon)
export const ListOrdered     = wrap(QueueListIcon)
export const ListChecks      = wrap(ClipboardDocumentIcon)
export const Quote           = wrap(ChatBubbleLeftEllipsisIcon)
export const Code            = wrap(CodeBracketIcon)
export const Code2           = wrap(CodeBracketIcon)
export const CodeIcon        = wrap(CodeBracketIcon)
export const Minus           = wrap(MinusIcon)
export const Bold            = wrap(BoldGlyph)
export const Italic          = wrap(ItalicGlyph)
export const Underline       = wrap(UnderlineGlyph)
export const UnderlineIcon   = wrap(UnderlineGlyph)
export const Strikethrough   = wrap(StrikethroughGlyph)
export const Subscript       = wrap(ChevronDownIcon)
export const SubIcon         = wrap(ChevronDownIcon)
export const Superscript     = wrap(ChevronUpIcon)
export const SupIcon         = wrap(ChevronUpIcon)
export const Highlighter     = wrap(PaintBrushIcon)
export const AlignLeft       = wrap(Bars3CenterLeftIcon)
export const AlignCenter     = wrap(Bars3Icon)
export const AlignRight      = wrap(Bars3BottomLeftIcon)
export const Copy            = wrap(DocumentDuplicateIcon)
export const CopyIcon        = wrap(DocumentDuplicateIcon)
export const Repeat          = wrap(ArrowPathIcon)
export const Image           = wrap(PhotoIcon)
export const ImageIcon       = wrap(PhotoIcon)
export const Table           = wrap(TableCellsIcon)
export const TableIcon       = wrap(TableCellsIcon)
export const Smile           = wrap(FaceSmileIcon)
export const Sigma           = wrap(CalculatorIcon)
export const Paperclip       = wrap(PaperClipIcon)
export const FileQuestion    = wrap(InformationCircleIcon)
export const BarChart3       = wrap(ChartBarIcon)
export const Wand2           = wrap(SparklesIcon)
