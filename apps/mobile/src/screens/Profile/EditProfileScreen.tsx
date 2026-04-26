import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import api from '../../services/api';

interface FormData {
  name: string;
  title: string;
  company: string;
  location: string;
  email: string;
}

export default function EditProfileScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { colors } = useTheme();

  const [formData, setFormData] = useState<FormData>({
    name: '',
    title: '',
    company: '',
    location: '',
    email: '',
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    const fetchProfile = async () => {
      if (!user) {
        setIsLoading(false);
        return;
      }

      const response = await api.getProfile(user.nodeId || user.id);
      if (response.data) {
        setFormData({
          name: response.data.name || '',
          title: response.data.title || '',
          company: response.data.company || '',
          location: response.data.location || '',
          email: user.email || '',
        });
      }
      setIsLoading(false);
    };

    fetchProfile();
  }, [user]);

  const updateField = (field: keyof FormData, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    setHasChanges(true);
  };

  const handleSave = async () => {
    if (!user || !hasChanges) return;

    setIsSaving(true);
    const response = await api.updateProfile(user.id, {
      name: formData.name,
      title: formData.title,
      company: formData.company,
      location: formData.location,
    });

    setIsSaving(false);

    if (response.error) {
      Alert.alert('Error', response.error);
    } else {
      setHasChanges(false);
      Alert.alert('Success', 'Profile updated successfully');
      navigation.goBack();
    }
  };

  const handleCancel = () => {
    if (hasChanges) {
      Alert.alert(
        'Discard Changes?',
        'You have unsaved changes. Are you sure you want to discard them?',
        [
          { text: 'Keep Editing', style: 'cancel' },
          { text: 'Discard', style: 'destructive', onPress: () => navigation.goBack() },
        ]
      );
    } else {
      navigation.goBack();
    }
  };

  if (isLoading) {
    return (
      <View style={[styles.centerContainer, { backgroundColor: colors.bgSecondary }]}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.bgSecondary }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 100 }]}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={[styles.sectionTitle, { color: colors.textMuted }]}>Personal Information</Text>

        <View style={[styles.fieldGroup, { backgroundColor: colors.bgPrimary }]}>
          <View style={styles.field}>
            <Text style={[styles.label, { color: colors.textSecondary }]}>Name</Text>
            <TextInput
              style={[styles.input, { color: colors.textPrimary, borderColor: colors.borderDefault }]}
              value={formData.name}
              onChangeText={(value) => updateField('name', value)}
              placeholder="Your full name"
              placeholderTextColor={colors.textLight}
            />
          </View>

          <View style={styles.field}>
            <Text style={[styles.label, { color: colors.textSecondary }]}>Title</Text>
            <TextInput
              style={[styles.input, { color: colors.textPrimary, borderColor: colors.borderDefault }]}
              value={formData.title}
              onChangeText={(value) => updateField('title', value)}
              placeholder="Your job title"
              placeholderTextColor={colors.textLight}
            />
          </View>

          <View style={styles.field}>
            <Text style={[styles.label, { color: colors.textSecondary }]}>Company</Text>
            <TextInput
              style={[styles.input, { color: colors.textPrimary, borderColor: colors.borderDefault }]}
              value={formData.company}
              onChangeText={(value) => updateField('company', value)}
              placeholder="Your company"
              placeholderTextColor={colors.textLight}
            />
          </View>

          <View style={[styles.field, { marginBottom: 0 }]}>
            <Text style={[styles.label, { color: colors.textSecondary }]}>Location</Text>
            <TextInput
              style={[styles.input, { color: colors.textPrimary, borderColor: colors.borderDefault }]}
              value={formData.location}
              onChangeText={(value) => updateField('location', value)}
              placeholder="City, Country"
              placeholderTextColor={colors.textLight}
            />
          </View>
        </View>

        <Text style={[styles.sectionTitle, { color: colors.textMuted }]}>Contact Information</Text>

        <View style={[styles.fieldGroup, { backgroundColor: colors.bgPrimary }]}>
          <View style={[styles.field, { marginBottom: 0 }]}>
            <Text style={[styles.label, { color: colors.textSecondary }]}>Email</Text>
            <TextInput
              style={[styles.input, styles.inputDisabled, { color: colors.textLight, borderColor: colors.borderLight, backgroundColor: colors.bgTertiary }]}
              value={formData.email}
              editable={false}
              placeholderTextColor={colors.textLight}
            />
            <Text style={[styles.helper, { color: colors.textLight }]}>Email cannot be changed</Text>
          </View>
        </View>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom, backgroundColor: colors.bgPrimary, borderTopColor: colors.borderLight }]}>
        <TouchableOpacity
          style={[styles.button, { backgroundColor: colors.bgTertiary }]}
          onPress={handleCancel}
          activeOpacity={0.7}
        >
          <Text style={[styles.cancelButtonText, { color: colors.textSecondary }]}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.button,
            { backgroundColor: colors.accent },
            (!hasChanges || isSaving) && styles.buttonDisabled,
          ]}
          onPress={handleSave}
          disabled={!hasChanges || isSaving}
          activeOpacity={0.7}
        >
          {isSaving ? (
            <ActivityIndicator size="small" color="#ffffff" />
          ) : (
            <Text style={styles.saveButtonText}>Save Changes</Text>
          )}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    padding: 16,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 20,
    marginBottom: 10,
    paddingHorizontal: 4,
  },
  fieldGroup: {
    borderRadius: 16,
    padding: 16,
  },
  field: {
    marginBottom: 16,
  },
  label: {
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
  },
  inputDisabled: {},
  helper: {
    fontSize: 12,
    marginTop: 4,
  },
  footer: {
    flexDirection: 'row',
    padding: 16,
    borderTopWidth: 1,
    gap: 12,
  },
  button: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  cancelButtonText: {
    fontSize: 15,
    fontWeight: '500',
  },
  saveButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#ffffff',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
});
