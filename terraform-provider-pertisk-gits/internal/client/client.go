package client

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

type Client struct {
	baseURL string
	token   string
	http    *http.Client
}

type Config struct {
	BaseURL  string
	Token    string
	Insecure bool
	Timeout  time.Duration
}

type APIError struct {
	Status  int
	Message string
}

func (e *APIError) Error() string {
	if e.Message != "" {
		return fmt.Sprintf("pertisk API %d: %s", e.Status, e.Message)
	}
	return fmt.Sprintf("pertisk API %d", e.Status)
}

func IsNotFound(err error) bool {
	api, ok := err.(*APIError)
	return ok && api.Status == http.StatusNotFound
}

func New(cfg Config) (*Client, error) {
	baseURL := strings.TrimRight(strings.TrimSpace(cfg.BaseURL), "/")
	if baseURL == "" {
		return nil, fmt.Errorf("base_url is required")
	}
	if _, err := url.Parse(baseURL); err != nil {
		return nil, fmt.Errorf("invalid base_url: %w", err)
	}
	if strings.TrimSpace(cfg.Token) == "" {
		return nil, fmt.Errorf("token is required")
	}
	timeout := cfg.Timeout
	if timeout == 0 {
		timeout = 60 * time.Second
	}
	transport := http.DefaultTransport.(*http.Transport).Clone()
	if cfg.Insecure {
		if transport.TLSClientConfig == nil {
			transport.TLSClientConfig = &tls.Config{}
		}
		transport.TLSClientConfig.InsecureSkipVerify = true
	}
	return &Client{
		baseURL: baseURL,
		token:   strings.TrimSpace(cfg.Token),
		http: &http.Client{
			Timeout:   timeout,
			Transport: transport,
		},
	}, nil
}

func orgPathSegment(orgPath string) string {
	return url.PathEscape(strings.Trim(orgPath, "/"))
}

func (c *Client) apiURL(path string) string {
	if !strings.HasPrefix(path, "/") {
		path = "/" + path
	}
	return c.baseURL + "/api/v1" + path
}

func (c *Client) do(ctx context.Context, method, path string, body any, out any) error {
	var reader io.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			return err
		}
		reader = bytes.NewReader(raw)
	}

	req, err := http.NewRequestWithContext(ctx, method, c.apiURL(path), reader)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+c.token)
	req.Header.Set("Accept", "application/json")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}

	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return err
	}

	if resp.StatusCode >= 400 {
		msg := strings.TrimSpace(string(data))
		if msg == "" {
			msg = resp.Status
		}
		return &APIError{Status: resp.StatusCode, Message: msg}
	}

	if out != nil && len(data) > 0 && resp.StatusCode != http.StatusNoContent {
		if err := json.Unmarshal(data, out); err != nil {
			return fmt.Errorf("decode response: %w", err)
		}
	}
	return nil
}

func (c *Client) CreateOrganization(ctx context.Context, req CreateOrganizationRequest) (*Organization, error) {
	var out Organization
	if err := c.do(ctx, http.MethodPost, "/organizations", req, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

func (c *Client) ListOrganizations(ctx context.Context) ([]Organization, error) {
	var out []Organization
	if err := c.do(ctx, http.MethodGet, "/organizations", nil, &out); err != nil {
		return nil, err
	}
	return out, nil
}

func (c *Client) GetOrganizationByPath(ctx context.Context, fullPath string) (*Organization, error) {
	orgs, err := c.ListOrganizations(ctx)
	if err != nil {
		return nil, err
	}
	fullPath = strings.Trim(fullPath, "/")
	for i := range orgs {
		if orgs[i].FullPath == fullPath {
			return &orgs[i], nil
		}
	}
	return nil, &APIError{Status: http.StatusNotFound, Message: fmt.Sprintf("organization %q not found", fullPath)}
}

func (c *Client) UpdateOrganization(ctx context.Context, orgPath string, req UpdateOrganizationRequest) (*Organization, error) {
	var out Organization
	if err := c.do(ctx, http.MethodPatch, "/organizations/"+orgPathSegment(orgPath), req, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

func (c *Client) DeleteOrganization(ctx context.Context, orgPath string) error {
	return c.do(ctx, http.MethodDelete, "/organizations/"+orgPathSegment(orgPath), nil, nil)
}

func (c *Client) CreateRepository(ctx context.Context, orgPath string, req CreateRepositoryRequest) (*Repository, error) {
	var out Repository
	path := fmt.Sprintf("/organizations/%s/repositories", orgPathSegment(orgPath))
	if err := c.do(ctx, http.MethodPost, path, req, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

func (c *Client) GetRepository(ctx context.Context, orgPath, repoSlug string) (*Repository, error) {
	var out RepositoryResponse
	path := fmt.Sprintf("/organizations/%s/repositories/%s", orgPathSegment(orgPath), url.PathEscape(repoSlug))
	if err := c.do(ctx, http.MethodGet, path, nil, &out); err != nil {
		return nil, err
	}
	return &out.Repository, nil
}

func (c *Client) UpdateRepository(ctx context.Context, orgPath, repoSlug string, req UpdateRepositoryRequest) (*Repository, error) {
	var out RepositoryResponse
	path := fmt.Sprintf("/organizations/%s/repositories/%s", orgPathSegment(orgPath), url.PathEscape(repoSlug))
	if err := c.do(ctx, http.MethodPatch, path, req, &out); err != nil {
		return nil, err
	}
	return &out.Repository, nil
}

func (c *Client) DeleteRepository(ctx context.Context, orgPath, repoSlug string) error {
	path := fmt.Sprintf("/organizations/%s/repositories/%s", orgPathSegment(orgPath), url.PathEscape(repoSlug))
	return c.do(ctx, http.MethodDelete, path, nil, nil)
}

func (c *Client) secretsBasePath(scope, orgPath, repoSlug string) (string, error) {
	switch scope {
	case "server":
		return "/admin/ci-secrets", nil
	case "group":
		if orgPath == "" {
			return "", fmt.Errorf("org_path is required for group scope")
		}
		return fmt.Sprintf("/organizations/%s/secrets", orgPathSegment(orgPath)), nil
	case "repository":
		if orgPath == "" || repoSlug == "" {
			return "", fmt.Errorf("org_path and repo_slug are required for repository scope")
		}
		return fmt.Sprintf(
			"/organizations/%s/repositories/%s/secrets",
			orgPathSegment(orgPath),
			url.PathEscape(repoSlug),
		), nil
	default:
		return "", fmt.Errorf("invalid scope %q (want server, group, or repository)", scope)
	}
}

func (c *Client) ListCiSecrets(ctx context.Context, scope, orgPath, repoSlug string) ([]CiSecret, error) {
	path, err := c.secretsBasePath(scope, orgPath, repoSlug)
	if err != nil {
		return nil, err
	}
	var out []CiSecret
	if err := c.do(ctx, http.MethodGet, path, nil, &out); err != nil {
		return nil, err
	}
	return out, nil
}

func (c *Client) CreateCiSecret(ctx context.Context, scope, orgPath, repoSlug string, req UpsertCiSecretRequest) (*CiSecret, error) {
	path, err := c.secretsBasePath(scope, orgPath, repoSlug)
	if err != nil {
		return nil, err
	}
	var out CiSecret
	if err := c.do(ctx, http.MethodPost, path, req, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

func (c *Client) UpdateCiSecret(ctx context.Context, scope, orgPath, repoSlug, id string, req UpdateCiSecretRequest) (*CiSecret, error) {
	base, err := c.secretsBasePath(scope, orgPath, repoSlug)
	if err != nil {
		return nil, err
	}
	var out CiSecret
	if err := c.do(ctx, http.MethodPatch, base+"/"+id, req, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

func (c *Client) DeleteCiSecret(ctx context.Context, scope, orgPath, repoSlug, id string) error {
	base, err := c.secretsBasePath(scope, orgPath, repoSlug)
	if err != nil {
		return err
	}
	return c.do(ctx, http.MethodDelete, base+"/"+id, nil, nil)
}

func (c *Client) GetCiSecretByID(ctx context.Context, scope, orgPath, repoSlug, id string) (*CiSecret, error) {
	items, err := c.ListCiSecrets(ctx, scope, orgPath, repoSlug)
	if err != nil {
		return nil, err
	}
	for i := range items {
		if items[i].ID == id {
			return &items[i], nil
		}
	}
	return nil, &APIError{Status: http.StatusNotFound, Message: fmt.Sprintf("ci entry id %s not found", id)}
}

func (c *Client) FindCiSecret(ctx context.Context, scope, orgPath, repoSlug, name, environment string) (*CiSecret, error) {
	items, err := c.ListCiSecrets(ctx, scope, orgPath, repoSlug)
	if err != nil {
		return nil, err
	}
	for i := range items {
		if items[i].Name == name && items[i].Environment == environment {
			return &items[i], nil
		}
	}
	return nil, &APIError{
		Status:  http.StatusNotFound,
		Message: fmt.Sprintf("ci entry %s/%s not found", name, environment),
	}
}
