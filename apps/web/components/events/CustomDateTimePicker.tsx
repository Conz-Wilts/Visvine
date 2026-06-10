'use client';

/**
 * Custom Date & Time Picker with brand styling
 */

import { useState, useRef, useEffect } from 'react';
import { Calendar, Clock, ChevronLeft, ChevronRight } from 'lucide-react';

interface CustomDateTimePickerProps {
  label: string;
  required?: boolean;
  value: string; // ISO string
  onChange: (isoString: string) => void;
  placeholder?: string;
}

export function CustomDateTimePicker({
  label,
  required = false,
  value,
  onChange,
  placeholder = 'Select date and time',
}: CustomDateTimePickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [currentMonth, setCurrentMonth] = useState(value ? new Date(value) : new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(value ? new Date(value) : null);
  const [selectedTime, setSelectedTime] = useState({
    hours: value ? new Date(value).getHours() : 9,
    minutes: value ? new Date(value).getMinutes() : 0,
  });

  // Update when value prop changes
  useEffect(() => {
    if (value) {
      const date = new Date(value);
      setSelectedDate(date);
      setSelectedTime({
        hours: date.getHours(),
        minutes: date.getMinutes(),
      });
      setCurrentMonth(date);
    }
  }, [value]);
  
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  const formatDisplayValue = () => {
    if (!selectedDate) return '';
    const date = selectedDate.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
    const time = `${String(selectedTime.hours % 12 || 12).padStart(2, '0')}:${String(selectedTime.minutes).padStart(2, '0')} ${selectedTime.hours >= 12 ? 'PM' : 'AM'}`;
    return `${date}, ${time}`;
  };

  const getDaysInMonth = (date: Date) => {
    const year = date.getFullYear();
    const month = date.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startDayOfWeek = firstDay.getDay();

    const days: (number | null)[] = [];
    
    // Add empty cells for days before the first day
    for (let i = 0; i < startDayOfWeek; i++) {
      days.push(null);
    }
    
    // Add actual days
    for (let i = 1; i <= daysInMonth; i++) {
      days.push(i);
    }

    return days;
  };

  const handleDateSelect = (day: number) => {
    const newDate = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), day, selectedTime.hours, selectedTime.minutes);
    setSelectedDate(newDate);
    onChange(newDate.toISOString());
  };

  const handleTimeChange = (hours: number, minutes: number) => {
    setSelectedTime({ hours, minutes });
    // If no date selected yet, use today
    const dateToUse = selectedDate || new Date();
    const newDate = new Date(dateToUse);
    newDate.setHours(hours);
    newDate.setMinutes(minutes);
    setSelectedDate(newDate);
    onChange(newDate.toISOString());
  };

  const navigateMonth = (direction: 'prev' | 'next') => {
    const newMonth = new Date(currentMonth);
    newMonth.setMonth(currentMonth.getMonth() + (direction === 'next' ? 1 : -1));
    setCurrentMonth(newMonth);
  };

  const days = getDaysInMonth(currentMonth);
  const today = new Date();
  const isToday = (day: number) => {
    return (
      day === today.getDate() &&
      currentMonth.getMonth() === today.getMonth() &&
      currentMonth.getFullYear() === today.getFullYear()
    );
  };

  const isSelected = (day: number) => {
    if (!selectedDate) return false;
    return (
      day === selectedDate.getDate() &&
      currentMonth.getMonth() === selectedDate.getMonth() &&
      currentMonth.getFullYear() === selectedDate.getFullYear()
    );
  };

  return (
    <div ref={containerRef} className="relative">
      <label className="block text-sm font-medium text-brand-black mb-2">
        {label}
        {required && <span className="text-brand-green"> *</span>}
      </label>

      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full px-4 py-3 border border-gray-200 rounded-xl bg-brand-white text-left font-medium focus:outline-none focus:ring-2 focus:ring-brand-green/20 focus:border-brand-green transition-all cursor-pointer hover:border-brand-green flex items-center justify-between gap-2"
      >
        <span className={selectedDate ? 'text-brand-black' : 'text-brand-grey'}>
          {formatDisplayValue() || placeholder}
        </span>
        <Calendar className="w-5 h-5 text-brand-green flex-shrink-0" />
      </button>

      {isOpen && (
        <div className="absolute z-50 mt-2 p-4 bg-brand-white border border-gray-200 rounded-xl shadow-2xl w-[300px]">
          {/* Calendar */}
          <div className="space-y-3">
            {/* Month navigation */}
            <div className="flex items-center justify-between mb-1">
              <button
                type="button"
                onClick={() => navigateMonth('prev')}
                className="p-1.5 hover:bg-brand-light-bg rounded-lg transition-colors"
              >
                <ChevronLeft className="w-4 h-4 text-brand-green" />
              </button>
              <h3 className="text-sm font-bold text-brand-black">
                {currentMonth.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
              </h3>
              <button
                type="button"
                onClick={() => navigateMonth('next')}
                className="p-1.5 hover:bg-brand-light-bg rounded-lg transition-colors"
              >
                <ChevronRight className="w-4 h-4 text-brand-green" />
              </button>
            </div>

            {/* Week days */}
            <div className="grid grid-cols-7 gap-0.5">
              {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((day) => (
                <div key={day} className="text-center text-[10px] font-semibold text-brand-grey py-1">
                  {day}
                </div>
              ))}
            </div>

            {/* Calendar days */}
            <div className="grid grid-cols-7 gap-0.5">
              {days.map((day, index) => (
                <button
                  key={index}
                  type="button"
                  onClick={() => day && handleDateSelect(day)}
                  disabled={!day}
                  className={`
                    h-8 rounded-lg text-xs font-semibold transition-all
                    ${!day ? 'invisible' : ''}
                    ${isSelected(day || 0) ? 'bg-brand-green text-brand-white shadow-sm' : ''}
                    ${!isSelected(day || 0) && isToday(day || 0) ? 'bg-brand-light-bg text-brand-green' : ''}
                    ${!isSelected(day || 0) && !isToday(day || 0) ? 'text-brand-black hover:bg-brand-light-bg' : ''}
                  `}
                >
                  {day}
                </button>
              ))}
            </div>

            {/* Time selection */}
            <div className="pt-3 border-t border-gray-200">
              <div className="flex items-center gap-1.5 mb-2">
                <Clock className="w-3.5 h-3.5 text-brand-green" />
                <span className="text-xs font-semibold text-brand-black">Time</span>
              </div>
              
              <div className="flex items-center justify-center gap-2">
                {/* Hours */}
                <div className="flex-1 min-w-0">
                  <input
                    type="number"
                    min="0"
                    max="23"
                    value={String(selectedTime.hours).padStart(2, '0')}
                    onChange={(e) => {
                      const val = parseInt(e.target.value);
                      if (!isNaN(val) && val >= 0 && val <= 23) {
                        handleTimeChange(val, selectedTime.minutes);
                      }
                    }}
                    className="w-full px-2 py-1.5 border border-gray-200 rounded-md bg-brand-white text-brand-black text-center font-bold text-base focus:outline-none focus:ring-1 focus:ring-brand-green focus:border-brand-green"
                  />
                  <p className="text-[10px] text-brand-grey text-center mt-0.5">Hour</p>
                </div>

                <span className="text-lg font-bold text-brand-grey pb-4">:</span>

                {/* Minutes */}
                <div className="flex-1 min-w-0">
                  <input
                    type="number"
                    min="0"
                    max="59"
                    value={String(selectedTime.minutes).padStart(2, '0')}
                    onChange={(e) => {
                      const val = parseInt(e.target.value);
                      if (!isNaN(val) && val >= 0 && val <= 59) {
                        handleTimeChange(selectedTime.hours, val);
                      }
                    }}
                    className="w-full px-2 py-1.5 border border-gray-200 rounded-md bg-brand-white text-brand-black text-center font-bold text-base focus:outline-none focus:ring-1 focus:ring-brand-green focus:border-brand-green"
                  />
                  <p className="text-[10px] text-brand-grey text-center mt-0.5">Min</p>
                </div>

                {/* AM/PM toggle */}
                <div className="flex-1">
                  <div className="flex flex-col gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        const newHours = selectedTime.hours >= 12 ? selectedTime.hours - 12 : selectedTime.hours + 12;
                        handleTimeChange(newHours, selectedTime.minutes);
                      }}
                      className={`px-2 py-1 text-xs font-bold rounded-sm transition-all ${
                        selectedTime.hours < 12
                          ? 'bg-brand-green text-brand-white'
                          : 'bg-brand-light-bg text-brand-black hover:bg-brand-light-bg'
                      }`}
                    >
                      AM
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const newHours = selectedTime.hours < 12 ? selectedTime.hours + 12 : selectedTime.hours;
                        handleTimeChange(newHours, selectedTime.minutes);
                      }}
                      className={`px-2 py-1 text-xs font-bold rounded-sm transition-all ${
                        selectedTime.hours >= 12
                          ? 'bg-brand-green text-brand-white'
                          : 'bg-brand-light-bg text-brand-black hover:bg-brand-light-bg'
                      }`}
                    >
                      PM
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Quick time presets */}
            <div className="flex gap-1.5 pt-2 border-t border-gray-200">
              {[
                { label: '9 AM', hours: 9 },
                { label: '12 PM', hours: 12 },
                { label: '6 PM', hours: 18 },
              ].map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => handleTimeChange(preset.hours, 0)}
                  className="flex-1 px-2 py-1.5 text-[10px] font-semibold text-brand-green bg-brand-light-bg rounded-md hover:bg-brand-light-bg transition-colors"
                >
                  {preset.label}
                </button>
              ))}
            </div>

            {/* Done button */}
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="w-full px-3 py-2 text-xs font-semibold text-brand-white bg-brand-green rounded-lg hover:opacity-90 transition-all shadow-sm"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

