package client

type Organization struct {
	ID          string  `json:"id"`
	Slug        string  `json:"slug"`
	Name        string  `json:"name"`
	Description *string `json:"description"`
	ParentID    *string `json:"parent_id"`
	FullPath    string  `json:"full_path"`
	IsMember    *bool   `json:"is_member,omitempty"`
}

type CreateOrganizationRequest struct {
	Name        string  `json:"name"`
	Slug        string  `json:"slug"`
	Description *string `json:"description,omitempty"`
	ParentPath  *string `json:"parent_path,omitempty"`
}

type UpdateOrganizationRequest struct {
	Name        *string `json:"name,omitempty"`
	Slug        *string `json:"slug,omitempty"`
	Description *string `json:"description,omitempty"`
}

type Repository struct {
	ID             string  `json:"id"`
	OrganizationID string  `json:"organization_id"`
	Name           string  `json:"name"`
	Slug           string  `json:"slug"`
	Description    *string `json:"description"`
	Visibility     string  `json:"visibility"`
	DefaultBranch  string  `json:"default_branch"`
}

type RepositoryResponse struct {
	Repository   Repository `json:"repository"`
	CloneURLHTTP string     `json:"clone_url_http"`
}

type CreateRepositoryRequest struct {
	Name        string  `json:"name"`
	Slug        string  `json:"slug"`
	Description *string `json:"description,omitempty"`
	Visibility  *string `json:"visibility,omitempty"`
}

type UpdateRepositoryRequest struct {
	Name        *string `json:"name,omitempty"`
	Description *string `json:"description,omitempty"`
	Visibility  *string `json:"visibility,omitempty"`
}

type CiSecret struct {
	ID          string  `json:"id"`
	Name        string  `json:"name"`
	SecretKind  string  `json:"secret_kind"`
	ConfigScope string  `json:"config_scope"`
	Masked      bool    `json:"masked"`
	Environment string  `json:"environment"`
	Value       *string `json:"value,omitempty"`
}

type UpsertCiSecretRequest struct {
	Name        string  `json:"name"`
	SecretKind  *string `json:"secret_kind,omitempty"`
	ConfigScope *string `json:"config_scope,omitempty"`
	Masked      *bool   `json:"masked,omitempty"`
	Environment *string `json:"environment,omitempty"`
	Value       string  `json:"value"`
}

type UpdateCiSecretRequest struct {
	SecretKind  *string `json:"secret_kind,omitempty"`
	ConfigScope *string `json:"config_scope,omitempty"`
	Masked      *bool   `json:"masked,omitempty"`
	Environment *string `json:"environment,omitempty"`
	Value       *string `json:"value,omitempty"`
}
