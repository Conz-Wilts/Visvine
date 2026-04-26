import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Image,
  ActivityIndicator,
  TouchableOpacity,
  Pressable,
  Linking,
  RefreshControl,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import api from '../../services/api';
import { useTheme } from '../../contexts/ThemeContext';
import { useAuth } from '../../contexts/AuthContext';
import {
  type FullProfile,
  type WorkExperience,
  type Education,
  type Certification,
  type ProfileLanguage,
  PROFICIENCY_LABELS,
} from '../../types';

type ProfileRoute = RouteProp<{ FullProfile: { personId: string; initialName?: string } }, 'FullProfile'>;

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function formatDateRange(start: string, end?: string | null, current?: boolean) {
  const fmt = (d: string) => {
    const [y, m] = d.split('-');
    if (!m) return y;
    const date = new Date(parseInt(y, 10), parseInt(m, 10) - 1);
    return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  };
  const s = fmt(start);
  const e = current ? 'Present' : end ? fmt(end) : 'Present';
  return `${s} – ${e}`;
}

function safeHostname(url: string) {
  try {
    return new URL(url).hostname.replace('www.', '');
  } catch {
    return url;
  }
}

function openUrl(url: string) {
  Linking.openURL(url).catch(() => Alert.alert('Could not open link', url));
}

export default function FullProfileScreen() {
  const navigation = useNavigation();
  const route = useRoute<ProfileRoute>();
  const { personId, initialName } = route.params;
  const { colors } = useTheme();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();

  const [profile, setProfile] = useState<FullProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await api.getFullProfile(personId);
    if (res.error) {
      setError(res.error);
      setProfile(null);
    } else if (res.data) {
      setProfile(res.data);
      setError(null);
    }
  }, [personId]);

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const isOwner = !!(user?.nodeId && user.nodeId === personId);

  const headerBar = (
    <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
      <TouchableOpacity
        onPress={() => navigation.goBack()}
        style={[styles.iconBtn, { backgroundColor: colors.bgPrimary }]}
        hitSlop={8}
      >
        <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
      </TouchableOpacity>
      <Text style={[styles.topBarTitle, { color: colors.textPrimary }]} numberOfLines={1}>
        {profile?.name || initialName || 'Profile'}
      </Text>
      <View style={styles.iconBtn} />
    </View>
  );

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bgSecondary }}>
        {headerBar}
        <View style={styles.centerFill}>
          <ActivityIndicator size="large" color={colors.accent} />
        </View>
      </View>
    );
  }

  if (error || !profile) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bgSecondary }}>
        {headerBar}
        <View style={styles.centerFill}>
          <View style={[styles.errorWrap, { backgroundColor: colors.bgPrimary }]}>
            <Ionicons name="alert-circle-outline" size={40} color={colors.textMuted} />
            <Text style={[styles.errorTitle, { color: colors.textPrimary }]}>Profile unavailable</Text>
            <Text style={[styles.errorBody, { color: colors.textMuted }]}>
              {error ?? 'This person may have been removed.'}
            </Text>
            <TouchableOpacity
              style={[styles.retryBtn, { backgroundColor: colors.accent }]}
              onPress={() => {
                setLoading(true);
                load().finally(() => setLoading(false));
              }}
            >
              <Text style={styles.retryBtnText}>Try again</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  }

  const hasContact = !!(
    profile.email ||
    profile.phone ||
    profile.website ||
    profile.linkedinUrl ||
    profile.twitterUrl
  );

  const joinedYear = profile.createdAt ? new Date(profile.createdAt).getFullYear() : null;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bgSecondary }}>
      {headerBar}
      <ScrollView
        contentContainerStyle={{ paddingBottom: 120 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />
        }
      >
        {/* Hero */}
        <View style={[styles.hero, { backgroundColor: colors.bgPrimary }]}>
          <View style={styles.avatarWrap}>
            {profile.imageUrl ? (
              <Image source={{ uri: profile.imageUrl }} style={styles.avatar} />
            ) : (
              <View style={[styles.avatar, styles.avatarFallback, { backgroundColor: colors.accent }]}>
                <Text style={styles.avatarInitials}>{initials(profile.name)}</Text>
              </View>
            )}
            {profile.openToWork && (
              <View style={[styles.openRing, { borderColor: colors.bgPrimary }]}>
                <Ionicons name="checkmark" size={12} color="#fff" />
              </View>
            )}
          </View>

          <View style={styles.heroText}>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', gap: 6 }}>
              <Text style={[styles.name, { color: colors.textPrimary }]}>{profile.name}</Text>
              {profile.pronouns && (
                <Text style={[styles.pronouns, { color: colors.textMuted }]}>({profile.pronouns})</Text>
              )}
            </View>

            {profile.subtitle && (
              <Text style={[styles.subtitle, { color: colors.textSecondary }]}>{profile.subtitle}</Text>
            )}

            {profile.openToWork && (
              <View style={[styles.openToWork, { backgroundColor: colors.accentLight, borderColor: colors.accent }]}>
                <View style={[styles.openDot, { backgroundColor: colors.accent }]} />
                <Text style={[styles.openText, { color: colors.accentDark }]}>Open to work</Text>
              </View>
            )}

            <View style={styles.metaRow}>
              {profile.location && (
                <View style={styles.metaItem}>
                  <Ionicons name="location-outline" size={14} color={colors.textMuted} />
                  <Text style={[styles.metaText, { color: colors.textMuted }]}>{profile.location}</Text>
                </View>
              )}
              {profile.website && (
                <Pressable style={styles.metaItem} onPress={() => openUrl(profile.website!)}>
                  <Ionicons name="open-outline" size={14} color={colors.accentDark} />
                  <Text style={[styles.metaText, { color: colors.accentDark }]}>
                    {safeHostname(profile.website)}
                  </Text>
                </Pressable>
              )}
            </View>

            {!isOwner && (
              <View style={styles.ctaRow}>
                <TouchableOpacity
                  style={[styles.ctaPrimary, { backgroundColor: colors.accent }]}
                  onPress={() => Alert.alert('Connect', 'Connect flow coming soon.')}
                >
                  <Ionicons name="person-add-outline" size={16} color="#fff" />
                  <Text style={styles.ctaPrimaryText}>Connect</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.ctaSecondary, { borderColor: colors.accent }]}
                  onPress={() => {
                    if (profile.email) {
                      openUrl(`mailto:${profile.email}`);
                    } else {
                      Alert.alert('No contact', 'This person has not listed an email.');
                    }
                  }}
                >
                  <Ionicons name="mail-outline" size={16} color={colors.accentDark} />
                  <Text style={[styles.ctaSecondaryText, { color: colors.accentDark }]}>Message</Text>
                </TouchableOpacity>
              </View>
            )}

            <View style={styles.statsRow}>
              {joinedYear && (
                <View style={[styles.statChip, { backgroundColor: colors.bgTertiary }]}>
                  <Ionicons name="calendar-outline" size={12} color={colors.textMuted} />
                  <Text style={[styles.statChipText, { color: colors.textSecondary }]}>
                    Member since {joinedYear}
                  </Text>
                </View>
              )}
              {profile.tags.length > 0 && (
                <View style={[styles.statChip, { backgroundColor: colors.bgTertiary }]}>
                  <Ionicons name="pricetag-outline" size={12} color={colors.textMuted} />
                  <Text style={[styles.statChipText, { color: colors.textSecondary }]}>
                    {profile.tags.length} skill{profile.tags.length === 1 ? '' : 's'}
                  </Text>
                </View>
              )}
            </View>
          </View>
        </View>

        {/* About */}
        {profile.bio ? (
          <Section title="About" icon="globe-outline" colors={colors}>
            <Text style={[styles.bodyText, { color: colors.textSecondary }]}>{profile.bio}</Text>
          </Section>
        ) : null}

        {/* Experience */}
        {profile.workExperience.length > 0 && (
          <Section title="Experience" icon="briefcase-outline" colors={colors}>
            {profile.workExperience.map((exp, i) => (
              <ExperienceRow
                key={exp.id}
                exp={exp}
                isLast={i === profile.workExperience.length - 1}
                colors={colors}
              />
            ))}
          </Section>
        )}

        {/* Education */}
        {profile.education.length > 0 && (
          <Section title="Education" icon="school-outline" colors={colors}>
            {profile.education.map((edu, i) => (
              <EducationRow
                key={edu.id}
                edu={edu}
                isLast={i === profile.education.length - 1}
                colors={colors}
              />
            ))}
          </Section>
        )}

        {/* Certifications */}
        {profile.certifications.length > 0 && (
          <Section title="Certifications" icon="ribbon-outline" colors={colors}>
            {profile.certifications.map((cert, i) => (
              <CertificationRow
                key={cert.id}
                cert={cert}
                isLast={i === profile.certifications.length - 1}
                colors={colors}
              />
            ))}
          </Section>
        )}

        {/* Skills */}
        {profile.tags.length > 0 && (
          <Section title="Skills" icon="construct-outline" colors={colors}>
            <View style={styles.pillCloud}>
              {profile.tags.map((tag) => (
                <View
                  key={tag}
                  style={[
                    styles.skillPill,
                    { backgroundColor: colors.accentLight, borderColor: colors.accent },
                  ]}
                >
                  <Text style={[styles.skillPillText, { color: colors.accentDark }]}>{tag}</Text>
                </View>
              ))}
            </View>
          </Section>
        )}

        {/* Languages */}
        {profile.languages.length > 0 && (
          <Section title="Languages" icon="language-outline" colors={colors}>
            {profile.languages.map((lang: ProfileLanguage) => (
              <View key={lang.id} style={styles.langRow}>
                <View style={[styles.langDot, { backgroundColor: colors.accent }]} />
                <Text style={[styles.langName, { color: colors.textPrimary }]}>{lang.language}</Text>
                <Text style={[styles.langProf, { color: colors.textMuted }]}>
                  {PROFICIENCY_LABELS[lang.proficiency] ?? lang.proficiency}
                </Text>
              </View>
            ))}
          </Section>
        )}

        {/* Contact */}
        {hasContact && (
          <Section title="Contact" icon="mail-outline" colors={colors}>
            {profile.email && (
              <ContactRow
                icon="mail-outline"
                label={profile.email}
                onPress={() => openUrl(`mailto:${profile.email}`)}
                colors={colors}
              />
            )}
            {profile.phone && (
              <ContactRow
                icon="call-outline"
                label={profile.phone}
                onPress={() => openUrl(`tel:${profile.phone}`)}
                colors={colors}
              />
            )}
            {profile.website && (
              <ContactRow
                icon="globe-outline"
                label={safeHostname(profile.website)}
                onPress={() => openUrl(profile.website!)}
                colors={colors}
              />
            )}
            {profile.linkedinUrl && (
              <ContactRow
                icon="logo-linkedin"
                label="LinkedIn"
                onPress={() => openUrl(profile.linkedinUrl!)}
                colors={colors}
              />
            )}
            {profile.twitterUrl && (
              <ContactRow
                icon="logo-twitter"
                label="X / Twitter"
                onPress={() => openUrl(profile.twitterUrl!)}
                colors={colors}
              />
            )}
          </Section>
        )}
      </ScrollView>
    </View>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Section({
  title,
  icon,
  colors,
  children,
}: {
  title: string;
  icon: keyof typeof Ionicons.glyphMap;
  colors: ReturnType<typeof useTheme>['colors'];
  children: React.ReactNode;
}) {
  return (
    <View style={[styles.section, { backgroundColor: colors.bgPrimary }]}>
      <View style={[styles.sectionHeader, { borderBottomColor: colors.borderLight }]}>
        <Ionicons name={icon} size={16} color={colors.textMuted} />
        <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>{title}</Text>
      </View>
      <View style={{ padding: 16 }}>{children}</View>
    </View>
  );
}

function ExperienceRow({
  exp,
  isLast,
  colors,
}: {
  exp: WorkExperience;
  isLast: boolean;
  colors: ReturnType<typeof useTheme>['colors'];
}) {
  return (
    <View style={[styles.timelineRow, !isLast && { marginBottom: 16 }]}>
      <View style={styles.timelineLeft}>
        <View style={[styles.timelineDot, { backgroundColor: colors.accent }]} />
        {!isLast && <View style={[styles.timelineLine, { backgroundColor: colors.borderDefault }]} />}
      </View>
      <View style={{ flex: 1, paddingBottom: isLast ? 0 : 4 }}>
        <Text style={[styles.entryTitle, { color: colors.textPrimary }]}>{exp.title}</Text>
        <Text style={[styles.entrySub, { color: colors.textSecondary }]}>{exp.company}</Text>
        <View style={styles.entryMetaRow}>
          <View style={[styles.rangePill, { backgroundColor: colors.accentLight }]}>
            <Text style={[styles.rangePillText, { color: colors.accentDark }]}>
              {formatDateRange(exp.startDate, exp.endDate, exp.current)}
            </Text>
          </View>
          {exp.location && (
            <Text style={[styles.entryMetaText, { color: colors.textMuted }]}>{exp.location}</Text>
          )}
        </View>
        {exp.description && (
          <Text style={[styles.entryDesc, { color: colors.textSecondary }]}>{exp.description}</Text>
        )}
      </View>
    </View>
  );
}

function EducationRow({
  edu,
  isLast,
  colors,
}: {
  edu: Education;
  isLast: boolean;
  colors: ReturnType<typeof useTheme>['colors'];
}) {
  const range =
    edu.startYear && edu.endYear
      ? `${edu.startYear} – ${edu.endYear}`
      : edu.startYear
        ? `From ${edu.startYear}`
        : edu.endYear
          ? `Until ${edu.endYear}`
          : null;
  return (
    <View style={[styles.iconRow, !isLast && { marginBottom: 16 }]}>
      <View style={[styles.iconBadge, { backgroundColor: colors.accentLight }]}>
        <Ionicons name="school" size={18} color={colors.accentDark} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.entryTitle, { color: colors.textPrimary }]}>{edu.school}</Text>
        {(edu.degree || edu.fieldOfStudy) && (
          <Text style={[styles.entrySub, { color: colors.textSecondary }]}>
            {[edu.degree, edu.fieldOfStudy].filter(Boolean).join(', ')}
          </Text>
        )}
        {range && (
          <View style={styles.entryMetaRow}>
            <View style={[styles.rangePill, { backgroundColor: colors.accentLight }]}>
              <Text style={[styles.rangePillText, { color: colors.accentDark }]}>{range}</Text>
            </View>
          </View>
        )}
        {edu.description && (
          <Text style={[styles.entryDesc, { color: colors.textSecondary }]}>{edu.description}</Text>
        )}
      </View>
    </View>
  );
}

function CertificationRow({
  cert,
  isLast,
  colors,
}: {
  cert: Certification;
  isLast: boolean;
  colors: ReturnType<typeof useTheme>['colors'];
}) {
  return (
    <View style={[styles.iconRow, !isLast && { marginBottom: 16 }]}>
      <View style={[styles.iconBadge, { backgroundColor: colors.accentLight }]}>
        <Ionicons name="ribbon" size={18} color={colors.accentDark} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.entryTitle, { color: colors.textPrimary }]}>{cert.name}</Text>
        <Text style={[styles.entrySub, { color: colors.textSecondary }]}>{cert.issuingOrg}</Text>
        {cert.issueDate && (
          <View style={styles.entryMetaRow}>
            <View style={[styles.rangePill, { backgroundColor: colors.accentLight }]}>
              <Text style={[styles.rangePillText, { color: colors.accentDark }]}>
                Issued {cert.issueDate}
                {cert.expiryDate ? ` · Expires ${cert.expiryDate}` : ''}
              </Text>
            </View>
          </View>
        )}
        {cert.credentialUrl && (
          <Pressable onPress={() => openUrl(cert.credentialUrl!)} style={styles.credLink}>
            <Ionicons name="open-outline" size={12} color={colors.accentDark} />
            <Text style={[styles.credLinkText, { color: colors.accentDark }]}>Show credential</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

function ContactRow({
  icon,
  label,
  onPress,
  colors,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  colors: ReturnType<typeof useTheme>['colors'];
}) {
  return (
    <TouchableOpacity onPress={onPress} style={styles.contactRow} activeOpacity={0.6}>
      <Ionicons name={icon} size={18} color={colors.textMuted} />
      <Text style={[styles.contactText, { color: colors.textSecondary }]} numberOfLines={1}>
        {label}
      </Text>
      <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
    </TouchableOpacity>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  centerFill: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingBottom: 8,
    gap: 8,
  },
  topBarTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 16,
    fontWeight: '600',
  },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorWrap: {
    padding: 24,
    borderRadius: 16,
    alignItems: 'center',
    gap: 8,
    width: '100%',
  },
  errorTitle: { fontSize: 16, fontWeight: '700' },
  errorBody: { fontSize: 14, textAlign: 'center' },
  retryBtn: {
    marginTop: 8,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 999,
  },
  retryBtnText: { color: '#fff', fontWeight: '600' },

  hero: {
    margin: 16,
    padding: 20,
    borderRadius: 20,
    gap: 16,
  },
  avatarWrap: {
    alignSelf: 'center',
    position: 'relative',
  },
  avatar: {
    width: 120,
    height: 120,
    borderRadius: 20,
  },
  avatarFallback: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarInitials: {
    fontSize: 40,
    fontWeight: '700',
    color: '#fff',
  },
  openRing: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#10b981',
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroText: {
    gap: 6,
    alignItems: 'center',
  },
  name: {
    fontSize: 24,
    fontWeight: '700',
    textAlign: 'center',
  },
  pronouns: {
    fontSize: 14,
  },
  subtitle: {
    fontSize: 15,
    lineHeight: 20,
    textAlign: 'center',
  },
  openToWork: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    marginTop: 2,
  },
  openDot: { width: 6, height: 6, borderRadius: 3 },
  openText: { fontSize: 12, fontWeight: '600' },

  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 12,
    marginTop: 4,
  },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText: { fontSize: 13 },

  ctaRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
    width: '100%',
  },
  ctaPrimary: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 999,
  },
  ctaPrimaryText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  ctaSecondary: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: 1.5,
  },
  ctaSecondaryText: { fontWeight: '600', fontSize: 14 },

  statsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 6,
    marginTop: 8,
  },
  statChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  statChipText: { fontSize: 12, fontWeight: '500' },

  section: {
    marginHorizontal: 16,
    marginBottom: 12,
    borderRadius: 16,
    overflow: 'hidden',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sectionTitle: { fontSize: 14, fontWeight: '700' },

  bodyText: { fontSize: 14, lineHeight: 21 },

  timelineRow: { flexDirection: 'row', gap: 12 },
  timelineLeft: { width: 14, alignItems: 'center' },
  timelineDot: { width: 10, height: 10, borderRadius: 5, marginTop: 5 },
  timelineLine: { width: 2, flex: 1, marginTop: 4 },
  entryTitle: { fontSize: 14, fontWeight: '600' },
  entrySub: { fontSize: 13, marginTop: 2 },
  entryMetaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
  },
  entryMetaText: { fontSize: 12 },
  entryDesc: { fontSize: 13, lineHeight: 19, marginTop: 6 },
  rangePill: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999 },
  rangePillText: { fontSize: 11, fontWeight: '600' },

  iconRow: { flexDirection: 'row', gap: 12 },
  iconBadge: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  credLink: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6 },
  credLinkText: { fontSize: 12, fontWeight: '500' },

  pillCloud: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  skillPill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
  },
  skillPillText: { fontSize: 12, fontWeight: '600' },

  langRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 6,
  },
  langDot: { width: 6, height: 6, borderRadius: 3 },
  langName: { fontSize: 14, fontWeight: '500' },
  langProf: { fontSize: 12, marginLeft: 'auto' },

  contactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
  },
  contactText: { flex: 1, fontSize: 14 },
});
