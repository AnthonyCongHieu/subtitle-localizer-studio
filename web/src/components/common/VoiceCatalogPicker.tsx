import React, { useMemo, useState } from 'react';
import { ChevronDown, Loader2, Volume2 } from 'lucide-react';
import {
  detectVoiceProvider,
  filterVoiceCatalog,
  getVoiceDropdownGroups,
  VOICE_CATEGORIES,
  type VoiceCategory,
  type VoiceItem,
} from '../../constants/voiceCatalog';

export interface VoiceCatalogPickerProps {
  selectedVoiceId: string;
  onChange: (voiceId: string) => void;
  gender?: VoiceItem['gender'];
  onPreview?: (voiceId: string) => void;
  previewingVoiceId?: string;
}

function ProviderBadge({ voiceId }: { voiceId: string }) {
  const provider = detectVoiceProvider(voiceId);
  if (provider === 'capcut') {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.2 rounded text-[9px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">
        {'\uD83C\uDFAC'} CapCut Cloud TTS
      </span>
    );
  }
  if (provider === 'edge') {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.2 rounded text-[9px] font-bold bg-sky-500/20 text-sky-300 border border-sky-500/40">
        {'\u26A1'} Microsoft Edge-TTS
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.2 rounded text-[9px] font-bold bg-purple-500/20 text-purple-300 border border-purple-500/40">
      {'\uD83C\uDF1F'} Gemini AI TTS
    </span>
  );
}

function classNames(selected: boolean, selectedClass: string, idleClass: string): string {
  return selected ? selectedClass : idleClass;
}

export const VoiceCatalogPicker: React.FC<VoiceCatalogPickerProps> = ({
  selectedVoiceId,
  onChange,
  gender,
  onPreview,
  previewingVoiceId,
}) => {
  const [selectedVoiceCategory, setSelectedVoiceCategory] = useState<VoiceCategory>('all');

  const filteredVoices = useMemo(
    () => filterVoiceCatalog({ category: selectedVoiceCategory, gender }),
    [selectedVoiceCategory, gender],
  );

  const dropdownGroups = useMemo(
    () => getVoiceDropdownGroups(filterVoiceCatalog({ gender })),
    [gender],
  );

  const knownIds = useMemo(
    () => new Set(dropdownGroups.flatMap((group) => group.options.map((opt) => opt.id))),
    [dropdownGroups],
  );

  return (
    <div
      className="space-y-2.5 pt-1"
      data-testid="voice-catalog-picker"
      data-gender={gender ?? 'all'}
    >
      <div className="flex items-center gap-1 overflow-x-auto pb-1 no-scrollbar">
        {VOICE_CATEGORIES.map((cat) => (
          <button
            key={cat.id}
            type="button"
            onClick={() => setSelectedVoiceCategory(cat.id)}
            className={classNames(
              selectedVoiceCategory === cat.id,
              'px-2 py-0.5 rounded text-[10px] font-semibold whitespace-nowrap transition cursor-pointer active:scale-95 bg-amber-500 text-slate-950 font-bold shadow-sm',
              'px-2 py-0.5 rounded text-[10px] font-semibold whitespace-nowrap transition cursor-pointer active:scale-95 bg-slate-950 text-slate-400 hover:text-slate-200 border border-slate-800',
            )}
          >
            {cat.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-1.5 max-h-48 overflow-y-auto pr-1 no-scrollbar">
        {filteredVoices.map((v) => {
          const isSelected = selectedVoiceId === v.id;
          const prov = detectVoiceProvider(v.id);
          const genderClass =
            v.gender === 'Nam' ? 'bg-indigo-500/20 text-indigo-300' : 'bg-pink-500/20 text-pink-300';
          const providerClass =
            prov === 'capcut' ? 'text-amber-400' : prov === 'edge' ? 'text-sky-400' : 'text-purple-400';
          return (
            <div
              key={v.id}
              onClick={() => onChange(v.id)}
              className={classNames(
                isSelected,
                'p-2 rounded-lg border transition cursor-pointer flex flex-col justify-between gap-1 select-none active:scale-98 bg-amber-500/15 border-amber-500/90 shadow-sm',
                'p-2 rounded-lg border transition cursor-pointer flex flex-col justify-between gap-1 select-none active:scale-98 bg-slate-950/90 hover:bg-slate-900 border-slate-800/90 hover:border-slate-700',
              )}
            >
              <div className="flex items-start justify-between gap-1">
                <div className="font-semibold text-slate-200 truncate text-[11px] flex items-center gap-1">
                  <span>{v.name}</span>
                  {v.popular && (
                    <span className="text-[8px] bg-rose-500/20 text-rose-300 px-1 rounded font-bold">HOT</span>
                  )}
                </div>
                <span className={'text-[8px] px-1 py-0.2 rounded font-bold shrink-0 ' + genderClass}>
                  {v.gender}
                </span>
              </div>

              <div className="flex items-center justify-between text-[9px] text-slate-400">
                <span className="truncate max-w-[70px]">{v.style}</span>
                <div className="flex items-center gap-1 shrink-0">
                  <span className={'font-mono font-bold ' + providerClass}>
                    {prov === 'capcut' ? 'CapCut' : prov === 'edge' ? 'Edge' : 'Gemini'}
                  </span>
                  {onPreview && (
                    <button
                      type="button"
                      data-testid="voice-preview-button"
                      data-voice-id={v.id}
                      title={`Nghe thử ${v.name}`}
                      disabled={previewingVoiceId === v.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        onPreview(v.id);
                      }}
                      className="p-1 rounded-md bg-slate-900/80 hover:bg-slate-800 text-slate-400 hover:text-amber-300 transition cursor-pointer active:scale-95 disabled:opacity-60"
                    >
                      {previewingVoiceId === v.id ? (
                        <Loader2 className="w-3 h-3 animate-spin text-amber-400" />
                      ) : (
                        <Volume2 className="w-3 h-3" />
                      )}
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
        {filteredVoices.length === 0 && (
          <div className="col-span-2 text-[10px] text-slate-500 text-center py-3">
            Không có giọng phù hợp bộ lọc.
          </div>
        )}
      </div>

      <div className="space-y-1 pt-1">
        <div className="flex items-center justify-between">
          <label className="text-slate-400 text-[10px] block font-medium">Hoặc chọn nhanh từ danh mục:</label>
          <ProviderBadge voiceId={selectedVoiceId} />
        </div>
        <div className="relative flex items-center">
          <select
            value={selectedVoiceId}
            onChange={(e) => onChange(e.target.value)}
            className="w-full bg-slate-950 hover:bg-slate-900 border border-slate-800 hover:border-slate-700 focus:border-indigo-500 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 appearance-none pr-7 focus:outline-none transition shadow-sm font-medium cursor-pointer"
          >
            {!knownIds.has(selectedVoiceId) && selectedVoiceId && (
              <option value={selectedVoiceId}>{selectedVoiceId}</option>
            )}
            {dropdownGroups.map((group) => (
              <optgroup key={group.label} label={group.label}>
                {group.options.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-2 pointer-events-none" />
        </div>
      </div>
    </div>
  );
};
