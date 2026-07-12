import { useEffect, useState } from 'react';
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import { AcademicYear, ClassStructure } from '../types';
import { getClassStructure } from '../services/academicYearService';
import PromotionWizard from './PromotionWizard';
import ArchiveSearchModal from './ArchiveSearchModal';

export default function AcademicYearPanel({
  schoolId, schoolName, onPromotionApplied,
}: {
  schoolId: string;
  schoolName: string;
  onPromotionApplied: () => void;
}) {
  const [structure, setStructure]   = useState<ClassStructure | null>(null);
  const [activeYearId, setActiveYearId] = useState('');
  const [years, setYears]           = useState<AcademicYear[]>([]);
  const [loading, setLoading]       = useState(true);
  const [showPromotion, setShowPromotion] = useState(false);
  const [showArchive, setShowArchive]     = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [structureRes, schoolSnap, yearsSnap] = await Promise.all([
        getClassStructure(schoolId),
        getDoc(doc(db, 'schools', schoolId)),
        getDocs(query(collection(db, 'academicYears'), where('schoolId', '==', schoolId))),
      ]);
      setStructure(structureRes);
      setActiveYearId(schoolSnap.exists() ? (schoolSnap.data().activeAcademicYearId || '') : '');
      setYears(
        yearsSnap.docs.map(d => d.data() as AcademicYear)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      );
    } catch (e) { console.error(e); }
    setLoading(false);
  }

  useEffect(() => { if (schoolId) load(); }, [schoolId]);

  const activeYear = years.find(y => y.id === activeYearId);

  if (loading) return <div className="card"><div className="card-body">Loading academic setup…</div></div>;
  if (!structure) return (
    <div className="card"><div className="card-body">
      No class structure found for this school yet. Contact support if this seems wrong.
    </div></div>
  );

  return (
    <div style={{ display: 'grid', gap: 24 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
        <div className="card">
          <div className="card-header"><span className="card-title">Class Structure</span></div>
          <div className="card-body">
            <div style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 10 }}>
              <strong>{structure.curriculum}</strong> · {structure.startingClass} → {structure.graduatingClass}
              {structure.streamsEnabled ? ` · streams (${structure.streamMode})` : ' · no streams'}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {structure.classes.map(c => (
                <span key={c} style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 6, padding: '3px 9px', fontSize: 12, fontFamily: "'DM Mono',monospace" }}>{c}</span>
              ))}
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-header"><span className="card-title">Current Academic Year</span></div>
          <div className="card-body">
            {activeYear ? (
              <>
                <div style={{ fontSize: 22, fontWeight: 800, marginBottom: 4 }}>{activeYear.label}</div>
                <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 16 }}>
                  Active since {new Date(activeYear.startDate).toLocaleDateString('en-KE')}
                </div>
              </>
            ) : (
              <div style={{ fontSize: 13, color: 'var(--text-3)', marginBottom: 16 }}>No active year found.</div>
            )}
            <button className="btn-primary" onClick={() => setShowPromotion(true)} style={{ width: '100%', justifyContent: 'center' }}>
              🎓 Start New Academic Year & Promote
            </button>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header"><span className="card-title">Academic Year History</span></div>
        <div className="card-body">
          {years.length === 0 ? (
            <div style={{ fontSize: 13, color: 'var(--text-3)' }}>No academic years recorded yet.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {years.map(y => (
                <div key={y.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', background: 'var(--surface-2)', borderRadius: 8, fontSize: 13 }}>
                  <span><strong>{y.label}</strong>{y.id === activeYearId ? ' — active' : ''}</span>
                  <span style={{ color: 'var(--text-3)', fontSize: 12 }}>
                    {y.status === 'closed' ? `Closed ${y.closedAt ? new Date(y.closedAt).toLocaleDateString('en-KE') : ''}` : 'Active'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-header"><span className="card-title">Graduate Records</span></div>
        <div className="card-body" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 13, color: 'var(--text-2)' }}>
            Graduated students are never deleted — search the permanent archive by admission number, national ID, or name.
          </div>
          <button className="btn-secondary" onClick={() => setShowArchive(true)}>🔍 Search Archive</button>
        </div>
      </div>

      {showPromotion && (
        <PromotionWizard
          schoolId={schoolId}
          onClose={() => setShowPromotion(false)}
          onApplied={async () => {
            setShowPromotion(false);
            await load();
            onPromotionApplied();
          }}
        />
      )}

      {showArchive && <ArchiveSearchModal onClose={() => setShowArchive(false)} />}
    </div>
  );
}
