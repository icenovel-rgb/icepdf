/**
 * 밑줄 모아보기 — 이 문서의 형광펜·밑줄을 쪽 순서로. 누르면 그 자리로 이동,
 * 항목마다 문장 카드·복사·삭제, 위에서 전체 복사·Markdown 저장.
 */
import { useEffect } from 'react'
import { useStore } from '../state/store'
import Icon from './Icon'
import { copyAllNotes, deleteNote, exportNotesMarkdown, gotoNote, openCard, refreshPdfNotes } from '../lib/reading'
import type { NoteItem } from '../../../shared/reading'

function formatDate(ms: number): string {
  if (!ms) return ''
  const d = new Date(ms)
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`
}

function NoteRow({ note }: { note: NoteItem }): React.JSX.Element {
  const copy = async (): Promise<void> => {
    await navigator.clipboard.writeText(note.text)
    useStore.getState().showToast('밑줄을 복사했습니다')
  }
  return (
    <li className={`note-row${note.page < 0 ? ' lost' : ''}`} onClick={() => gotoNote(note)}>
      <span className={`note-chip ${note.style}`} style={{ ['--note' as string]: note.color }} />
      <div className="note-body">
        <p className="note-text">{note.text}</p>
        <div className="note-meta">
          <span>{note.page < 0 ? '위치를 찾지 못함' : `${note.page + 1}쪽`}</span>
          {note.createdAt > 0 && <span>{formatDate(note.createdAt)}</span>}
        </div>
      </div>
      <div className="note-actions" onClick={(e) => e.stopPropagation()}>
        <button title="문장 카드 이미지 만들기" onClick={() => openCard(note.text)}><Icon name="quote" size={15} /></button>
        <button title="복사" onClick={() => void copy()}><Icon name="copy" size={15} /></button>
        <button title="삭제" onClick={() => void deleteNote(note.id)}><Icon name="trash" size={15} /></button>
      </div>
    </li>
  )
}

export default function NotesPanel(): React.JSX.Element {
  const notes = useStore((s) => s.notes)
  const kind = useStore((s) => s.info?.kind)
  const docId = useStore((s) => s.activeDocId)
  const epoch = useStore((s) => s.epoch)

  // PDF 형광펜은 문서 주석 — 편집·되돌리기(epoch)마다 다시 읽는다
  useEffect(() => {
    if (kind === 'pdf') void refreshPdfNotes(docId)
  }, [kind, docId, epoch])

  return (
    <div className="notes-panel">
      <div className="notes-head">
        <span className="notes-count">밑줄 {notes.length}개</span>
        <button disabled={!notes.length} onClick={() => void copyAllNotes()} title="전체를 Markdown으로 복사">
          <Icon name="copy" size={15} /> 복사
        </button>
        <button disabled={!notes.length} onClick={() => void exportNotesMarkdown()} title="Markdown 파일로 저장">
          <Icon name="download" size={15} /> 저장
        </button>
      </div>
      {notes.length === 0 ? (
        <p className="notes-empty">
          글자를 드래그해 선택한 뒤 위에 뜨는 색을 누르면 밑줄이 생깁니다.
          <br />
          형광펜 도구로 드래그해도 됩니다.
        </p>
      ) : (
        <ul className="notes-list">
          {notes.map((n) => (
            <NoteRow key={n.id} note={n} />
          ))}
        </ul>
      )}
    </div>
  )
}
