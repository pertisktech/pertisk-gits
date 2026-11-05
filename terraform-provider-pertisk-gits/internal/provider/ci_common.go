package provider

import (
	"fmt"
	"strings"

	"github.com/hashicorp/terraform-plugin-framework/types"

	"github.com/pertisktech/pertisk-gits/terraform-provider-pertisk-gits/internal/client"
)

type ciEntryModel struct {
	ID          types.String `tfsdk:"id"`
	Scope       types.String `tfsdk:"scope"`
	OrgPath     types.String `tfsdk:"org_path"`
	RepoSlug    types.String `tfsdk:"repo_slug"`
	Name        types.String `tfsdk:"name"`
	Environment types.String `tfsdk:"environment"`
	Masked      types.Bool   `tfsdk:"masked"`
	SecretKind  types.String `tfsdk:"secret_kind"`
	Value       types.String `tfsdk:"value"`
}

func orgPathValue(m ciEntryModel) string {
	if m.OrgPath.IsNull() || m.OrgPath.IsUnknown() {
		return ""
	}
	return m.OrgPath.ValueString()
}

func repoSlugValue(m ciEntryModel) string {
	if m.RepoSlug.IsNull() || m.RepoSlug.IsUnknown() {
		return ""
	}
	return m.RepoSlug.ValueString()
}

func validateCiScope(m ciEntryModel) error {
	switch m.Scope.ValueString() {
	case "server":
		return nil
	case "group":
		if orgPathValue(m) == "" {
			return fmt.Errorf("org_path is required when scope is group")
		}
	case "repository":
		if orgPathValue(m) == "" || repoSlugValue(m) == "" {
			return fmt.Errorf("org_path and repo_slug are required when scope is repository")
		}
	default:
		return fmt.Errorf("scope must be server, group, or repository")
	}
	return nil
}

func applyCiEntryState(model *ciEntryModel, entry *client.CiSecret, keepValue bool) {
	model.ID = types.StringValue(entry.ID)
	model.Name = types.StringValue(entry.Name)
	model.Environment = types.StringValue(entry.Environment)
	model.Masked = types.BoolValue(entry.Masked)
	model.SecretKind = types.StringValue(entry.SecretKind)
	if keepValue {
		// value stays from plan/state (write-only for secrets; variables may come from API)
	} else if entry.Value != nil {
		model.Value = types.StringValue(*entry.Value)
	}
}

// parseCiImportID accepts:
//   - UUID
//   - server/NAME/env
//   - group/ORG/NAME/env
//   - repo/ORG/REPO/NAME/env
func parseCiImportID(id string) (scope, orgPath, repoSlug, name, environment, uuid string, err error) {
	id = strings.TrimSpace(id)
	if id == "" {
		return "", "", "", "", "", "", fmt.Errorf("empty import id")
	}
	if !strings.Contains(id, "/") {
		return "", "", "", "", "", id, nil
	}
	parts := strings.Split(id, "/")
	switch parts[0] {
	case "server":
		if len(parts) != 3 {
			return "", "", "", "", "", "", fmt.Errorf("server import id must be server/NAME/env")
		}
		return "server", "", "", parts[1], parts[2], "", nil
	case "group":
		if len(parts) < 4 {
			return "", "", "", "", "", "", fmt.Errorf("group import id must be group/ORG/NAME/env")
		}
		env := parts[len(parts)-1]
		name = parts[len(parts)-2]
		orgPath = strings.Join(parts[1:len(parts)-2], "/")
		return "group", orgPath, "", name, env, "", nil
	case "repo", "repository":
		if len(parts) < 5 {
			return "", "", "", "", "", "", fmt.Errorf("repo import id must be repo/ORG/REPO/NAME/env")
		}
		env := parts[len(parts)-1]
		name = parts[len(parts)-2]
		repoSlug = parts[len(parts)-3]
		orgPath = strings.Join(parts[1:len(parts)-3], "/")
		return "repository", orgPath, repoSlug, name, env, "", nil
	default:
		return "", "", "", "", "", "", fmt.Errorf("import id must start with server/, group/, or repo/")
	}
}
