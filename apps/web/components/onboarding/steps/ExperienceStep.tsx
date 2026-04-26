'use client';

import { useState } from 'react';
import { ArrowLeft, ArrowRight, Plus, Trash2, Briefcase, GraduationCap } from 'lucide-react';
import type { OnboardingData, ExperienceEntry, EducationEntry } from '@/app/onboarding/OnboardingWizard';

interface Props {
  data: OnboardingData;
  onNext: (data: Partial<OnboardingData>) => void;
  onBack: () => void;
  saving: boolean;
}

function ExperienceForm({ onAdd }: { onAdd: (entry: ExperienceEntry) => void }) {
  const [title, setTitle] = useState('');
  const [company, setCompany] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [current, setCurrent] = useState(false);

  const canAdd = title && company && startDate;

  const handleAdd = () => {
    onAdd({ title, company, startDate, endDate: current ? undefined : endDate, current, isNew: true });
    setTitle(''); setCompany(''); setStartDate(''); setEndDate(''); setCurrent(false);
  };

  return (
    <div className="space-y-3 bg-gray-50 rounded-lg p-4">
      <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Job title" className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-green/30 focus:border-brand-green" />
      <input type="text" value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Company" className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-green/30 focus:border-brand-green" />
      <div className="flex gap-2">
        <input type="month" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-green/30 focus:border-brand-green" />
        {!current && <input type="month" value={endDate} onChange={(e) => setEndDate(e.target.value)} placeholder="End" className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-green/30 focus:border-brand-green" />}
      </div>
      <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
        <input type="checkbox" checked={current} onChange={(e) => setCurrent(e.target.checked)} className="rounded border-gray-300 text-brand-green focus:ring-brand-green" />
        I currently work here
      </label>
      <button onClick={handleAdd} disabled={!canAdd} className="text-sm font-medium text-brand-green hover:text-brand-dark-green disabled:text-gray-300 transition-colors">
        + Add experience
      </button>
    </div>
  );
}

function EducationForm({ onAdd }: { onAdd: (entry: EducationEntry) => void }) {
  const [school, setSchool] = useState('');
  const [degree, setDegree] = useState('');
  const [fieldOfStudy, setFieldOfStudy] = useState('');
  const [startYear, setStartYear] = useState('');
  const [endYear, setEndYear] = useState('');

  const handleAdd = () => {
    if (!school) return;
    onAdd({ school, degree, fieldOfStudy, startYear, endYear, isNew: true });
    setSchool(''); setDegree(''); setFieldOfStudy(''); setStartYear(''); setEndYear('');
  };

  return (
    <div className="space-y-3 bg-gray-50 rounded-lg p-4">
      <input type="text" value={school} onChange={(e) => setSchool(e.target.value)} placeholder="School or university" className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-green/30 focus:border-brand-green" />
      <div className="flex gap-2">
        <input type="text" value={degree} onChange={(e) => setDegree(e.target.value)} placeholder="Degree" className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-green/30 focus:border-brand-green" />
        <input type="text" value={fieldOfStudy} onChange={(e) => setFieldOfStudy(e.target.value)} placeholder="Field of study" className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-green/30 focus:border-brand-green" />
      </div>
      <div className="flex gap-2">
        <input type="number" value={startYear} onChange={(e) => setStartYear(e.target.value)} placeholder="Start year" min="1950" max="2030" className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-green/30 focus:border-brand-green" />
        <input type="number" value={endYear} onChange={(e) => setEndYear(e.target.value)} placeholder="End year" min="1950" max="2035" className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-green/30 focus:border-brand-green" />
      </div>
      <button onClick={handleAdd} disabled={!school} className="text-sm font-medium text-brand-green hover:text-brand-dark-green disabled:text-gray-300 transition-colors">
        + Add education
      </button>
    </div>
  );
}

export default function ExperienceStep({ data, onNext, onBack, saving }: Props) {
  const [workExperience, setWorkExperience] = useState<ExperienceEntry[]>(data.workExperience);
  const [education, setEducation] = useState<EducationEntry[]>(data.education);
  const [showExpForm, setShowExpForm] = useState(workExperience.length === 0);
  const [showEduForm, setShowEduForm] = useState(false);

  const addExperience = (entry: ExperienceEntry) => {
    setWorkExperience((prev) => [...prev, entry]);
    setShowExpForm(false);
  };

  const removeExperience = (index: number) => {
    setWorkExperience((prev) => prev.filter((_, i) => i !== index));
  };

  const addEducation = (entry: EducationEntry) => {
    setEducation((prev) => [...prev, entry]);
    setShowEduForm(false);
  };

  const removeEducation = (index: number) => {
    setEducation((prev) => prev.filter((_, i) => i !== index));
  };

  return (
    <div className="p-8">
      <h2 className="text-xl font-bold text-gray-900 mb-1">Experience & Education</h2>
      <p className="text-sm text-gray-500 mb-6">Share your professional background.</p>

      {/* Work Experience */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
            <Briefcase className="w-4 h-4" /> Work Experience
          </h3>
          {!showExpForm && (
            <button onClick={() => setShowExpForm(true)} className="text-xs text-brand-green hover:text-brand-dark-green font-medium flex items-center gap-1">
              <Plus className="w-3 h-3" /> Add
            </button>
          )}
        </div>

        {workExperience.map((exp, i) => (
          <div key={i} className="flex items-start justify-between bg-gray-50 rounded-lg p-3 mb-2">
            <div>
              <p className="text-sm font-medium text-gray-900">{exp.title}</p>
              <p className="text-xs text-gray-500">{exp.company} {exp.current ? '(Current)' : ''}</p>
            </div>
            <button onClick={() => removeExperience(i)} className="text-gray-400 hover:text-red-500 transition-colors">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}

        {showExpForm && <ExperienceForm onAdd={addExperience} />}
      </div>

      {/* Education */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
            <GraduationCap className="w-4 h-4" /> Education
          </h3>
          {!showEduForm && (
            <button onClick={() => setShowEduForm(true)} className="text-xs text-brand-green hover:text-brand-dark-green font-medium flex items-center gap-1">
              <Plus className="w-3 h-3" /> Add
            </button>
          )}
        </div>

        {education.map((edu, i) => (
          <div key={i} className="flex items-start justify-between bg-gray-50 rounded-lg p-3 mb-2">
            <div>
              <p className="text-sm font-medium text-gray-900">{edu.school}</p>
              <p className="text-xs text-gray-500">{[edu.degree, edu.fieldOfStudy].filter(Boolean).join(', ')}</p>
            </div>
            <button onClick={() => removeEducation(i)} className="text-gray-400 hover:text-red-500 transition-colors">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}

        {showEduForm && <EducationForm onAdd={addEducation} />}
      </div>

      <div className="flex justify-between mt-8">
        <button onClick={onBack} className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 transition-colors">
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
        <button
          onClick={() => onNext({ workExperience, education })}
          disabled={saving}
          className="bg-brand-green text-white rounded-full px-6 py-2.5 text-sm font-semibold hover:opacity-90 active:translate-y-[1px] transition-all duration-200 shadow-soft flex items-center gap-1 disabled:opacity-60"
        >
          {saving ? 'Saving...' : 'Next'} {!saving && <ArrowRight className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
}
