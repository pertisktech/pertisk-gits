{{/*
Expand the name of the chart.
*/}}
{{- define "pertisk-runner.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "pertisk-runner.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{- define "pertisk-runner.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "pertisk-runner.labels" -}}
helm.sh/chart: {{ include "pertisk-runner.chart" . }}
{{ include "pertisk-runner.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/component: ci-runner
{{- end }}

{{/*
Selector labels
*/}}
{{- define "pertisk-runner.selectorLabels" -}}
app.kubernetes.io/name: {{ include "pertisk-runner.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Service account name
*/}}
{{- define "pertisk-runner.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "pertisk-runner.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
Secret name for runner token
*/}}
{{- define "pertisk-runner.secretName" -}}
{{- if .Values.existingSecret.name }}
{{- .Values.existingSecret.name }}
{{- else }}
{{- include "pertisk-runner.fullname" . }}
{{- end }}
{{- end }}

{{/*
Image tag
*/}}
{{- define "pertisk-runner.imageTag" -}}
{{- .Values.image.tag | default .Chart.AppVersion }}
{{- end }}

{{- define "pertisk-runner.kubernetesExecutor" -}}
{{- eq .Values.executor "kubernetes" -}}
{{- end }}

{{- define "pertisk-runner.jobNamespace" -}}
{{- .Values.kubernetes.namespace | default .Release.Namespace }}
{{- end }}

{{/*
Default pod anti-affinity — spread runner pods across nodes.
*/}}
{{- define "pertisk-runner.podAntiAffinity" -}}
podAntiAffinity:
  preferredDuringSchedulingIgnoredDuringExecution:
    - weight: 100
      podAffinityTerm:
        topologyKey: kubernetes.io/hostname
        labelSelector:
          matchLabels:
            {{- include "pertisk-runner.selectorLabels" . | nindent 12 }}
{{- end }}

{{/*
Merged affinity: user values win; else default anti-affinity when enabled.
*/}}
{{- define "pertisk-runner.affinity" -}}
{{- if .Values.affinity -}}
{{- toYaml .Values.affinity }}
{{- else if .Values.podAntiAffinity.enabled }}
{{- include "pertisk-runner.podAntiAffinity" . }}
{{- end }}
{{- end }}
