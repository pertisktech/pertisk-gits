package provider

import (
	"context"

	"github.com/hashicorp/terraform-plugin-framework/path"
	"github.com/hashicorp/terraform-plugin-framework/resource"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/booldefault"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/planmodifier"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/stringdefault"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/stringplanmodifier"
	"github.com/hashicorp/terraform-plugin-framework/types"

	"github.com/pertisktech/pertisk-gits/terraform-provider-pertisk-gits/internal/client"
)

var (
	_ resource.Resource                = &ciVariableResource{}
	_ resource.ResourceWithConfigure   = &ciVariableResource{}
	_ resource.ResourceWithImportState = &ciVariableResource{}
)

func NewCiVariableResource() resource.Resource { return &ciVariableResource{} }

type ciVariableResource struct {
	api *client.Client
}

func (r *ciVariableResource) Metadata(_ context.Context, req resource.MetadataRequest, resp *resource.MetadataResponse) {
	resp.TypeName = req.ProviderTypeName + "_ci_variable"
}

func (r *ciVariableResource) Schema(_ context.Context, _ resource.SchemaRequest, resp *resource.SchemaResponse) {
	resp.Schema = schema.Schema{
		MarkdownDescription: "A CI variable (`vars.NAME`) at server, group, or repository scope.",
		Attributes:          ciSchema(false),
	}
}

func ciSchema(secret bool) map[string]schema.Attribute {
	attrs := map[string]schema.Attribute{
		"id": schema.StringAttribute{
			Computed: true,
			PlanModifiers: []planmodifier.String{
				stringplanmodifier.UseStateForUnknown(),
			},
		},
		"scope": schema.StringAttribute{
			Required:            true,
			MarkdownDescription: "`server`, `group`, or `repository`.",
			PlanModifiers: []planmodifier.String{
				stringplanmodifier.RequiresReplace(),
			},
		},
		"org_path": schema.StringAttribute{
			Optional:            true,
			MarkdownDescription: "Group full path (required for group/repository scope).",
			PlanModifiers: []planmodifier.String{
				stringplanmodifier.RequiresReplace(),
			},
		},
		"repo_slug": schema.StringAttribute{
			Optional:            true,
			MarkdownDescription: "Repository slug (required for repository scope).",
			PlanModifiers: []planmodifier.String{
				stringplanmodifier.RequiresReplace(),
			},
		},
		"name": schema.StringAttribute{
			Required:            true,
			MarkdownDescription: "Name matching `[A-Z][A-Z0-9_]*`.",
			PlanModifiers: []planmodifier.String{
				stringplanmodifier.RequiresReplace(),
			},
		},
		"environment": schema.StringAttribute{
			Optional:            true,
			Computed:            true,
			Default:             stringdefault.StaticString("all"),
			MarkdownDescription: "`all`, `dev`, `qa`, `uat`, or `prd`.",
			PlanModifiers: []planmodifier.String{
				stringplanmodifier.RequiresReplace(),
			},
		},
		"masked": schema.BoolAttribute{
			Optional:            true,
			Computed:            true,
			Default:             booldefault.StaticBool(secret),
			MarkdownDescription: "Mask value in job logs.",
		},
		"value": schema.StringAttribute{
			Required:            true,
			Sensitive:           secret,
			MarkdownDescription: "Variable or secret value.",
		},
	}
	if secret {
		attrs["secret_kind"] = schema.StringAttribute{
			Optional:            true,
			Computed:            true,
			Default:             stringdefault.StaticString("variable"),
			MarkdownDescription: "`variable` (env) or `file`.",
		}
	} else {
		attrs["secret_kind"] = schema.StringAttribute{
			Computed:            true,
			MarkdownDescription: "Always `variable` for CI variables.",
			PlanModifiers: []planmodifier.String{
				stringplanmodifier.UseStateForUnknown(),
			},
		}
	}
	return attrs
}

func (r *ciVariableResource) Configure(_ context.Context, req resource.ConfigureRequest, resp *resource.ConfigureResponse) {
	r.api = configureClient(req.ProviderData, &resp.Diagnostics)
}

func (r *ciVariableResource) Create(ctx context.Context, req resource.CreateRequest, resp *resource.CreateResponse) {
	var plan ciEntryModel
	resp.Diagnostics.Append(req.Plan.Get(ctx, &plan)...)
	if resp.Diagnostics.HasError() {
		return
	}
	if err := validateCiScope(plan); err != nil {
		resp.Diagnostics.AddError("Invalid configuration", err.Error())
		return
	}

	scope := "variable"
	body := client.UpsertCiSecretRequest{
		Name:        plan.Name.ValueString(),
		ConfigScope: &scope,
		Masked:      boolPtr(plan.Masked.ValueBool()),
		Environment: stringPtr(plan.Environment.ValueString()),
		Value:       plan.Value.ValueString(),
	}
	entry, err := r.api.CreateCiSecret(ctx, plan.Scope.ValueString(), orgPathValue(plan), repoSlugValue(plan), body)
	if err != nil {
		resp.Diagnostics.AddError("Create CI variable failed", err.Error())
		return
	}
	applyCiEntryState(&plan, entry, false)
	plan.SecretKind = types.StringValue("variable")
	resp.Diagnostics.Append(resp.State.Set(ctx, &plan)...)
}

func (r *ciVariableResource) Read(ctx context.Context, req resource.ReadRequest, resp *resource.ReadResponse) {
	var state ciEntryModel
	resp.Diagnostics.Append(req.State.Get(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}
	entry, err := r.api.GetCiSecretByID(ctx, state.Scope.ValueString(), orgPathValue(state), repoSlugValue(state), state.ID.ValueString())
	if err != nil {
		if client.IsNotFound(err) {
			resp.State.RemoveResource(ctx)
			return
		}
		resp.Diagnostics.AddError("Read CI variable failed", err.Error())
		return
	}
	applyCiEntryState(&state, entry, false)
	resp.Diagnostics.Append(resp.State.Set(ctx, &state)...)
}

func (r *ciVariableResource) Update(ctx context.Context, req resource.UpdateRequest, resp *resource.UpdateResponse) {
	var plan ciEntryModel
	var state ciEntryModel
	resp.Diagnostics.Append(req.Plan.Get(ctx, &plan)...)
	resp.Diagnostics.Append(req.State.Get(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}
	scope := "variable"
	body := client.UpdateCiSecretRequest{
		ConfigScope: &scope,
		Masked:      boolPtr(plan.Masked.ValueBool()),
		Value:       stringPtr(plan.Value.ValueString()),
	}
	entry, err := r.api.UpdateCiSecret(ctx, state.Scope.ValueString(), orgPathValue(state), repoSlugValue(state), state.ID.ValueString(), body)
	if err != nil {
		resp.Diagnostics.AddError("Update CI variable failed", err.Error())
		return
	}
	plan.Scope = state.Scope
	plan.OrgPath = state.OrgPath
	plan.RepoSlug = state.RepoSlug
	plan.Name = state.Name
	plan.Environment = state.Environment
	applyCiEntryState(&plan, entry, false)
	resp.Diagnostics.Append(resp.State.Set(ctx, &plan)...)
}

func (r *ciVariableResource) Delete(ctx context.Context, req resource.DeleteRequest, resp *resource.DeleteResponse) {
	var state ciEntryModel
	resp.Diagnostics.Append(req.State.Get(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}
	if err := r.api.DeleteCiSecret(ctx, state.Scope.ValueString(), orgPathValue(state), repoSlugValue(state), state.ID.ValueString()); err != nil && !client.IsNotFound(err) {
		resp.Diagnostics.AddError("Delete CI variable failed", err.Error())
	}
}

func (r *ciVariableResource) ImportState(ctx context.Context, req resource.ImportStateRequest, resp *resource.ImportStateResponse) {
	importCiState(ctx, r.api, req.ID, "variable", resp)
}

func importCiState(ctx context.Context, api *client.Client, importID, wantScope string, resp *resource.ImportStateResponse) {
	scope, orgPath, repoSlug, name, environment, uuid, err := parseCiImportID(importID)
	if err != nil {
		resp.Diagnostics.AddError("Invalid import id", err.Error())
		return
	}

	var entry *client.CiSecret
	if uuid != "" {
		resp.Diagnostics.AddError(
			"UUID-only import needs composite id",
			"Use server/NAME/env, group/ORG/NAME/env, or repo/ORG/REPO/NAME/env so scope can be resolved.",
		)
		return
	}
	entry, err = api.FindCiSecret(ctx, scope, orgPath, repoSlug, name, environment)
	if err != nil {
		resp.Diagnostics.AddError("Import CI entry failed", err.Error())
		return
	}
	if entry.ConfigScope != wantScope {
		resp.Diagnostics.AddError(
			"Wrong resource type",
			"Imported entry config_scope is "+entry.ConfigScope+", expected "+wantScope+".",
		)
		return
	}

	resp.Diagnostics.Append(resp.State.SetAttribute(ctx, path.Root("id"), entry.ID)...)
	resp.Diagnostics.Append(resp.State.SetAttribute(ctx, path.Root("scope"), scope)...)
	if orgPath != "" {
		resp.Diagnostics.Append(resp.State.SetAttribute(ctx, path.Root("org_path"), orgPath)...)
	}
	if repoSlug != "" {
		resp.Diagnostics.Append(resp.State.SetAttribute(ctx, path.Root("repo_slug"), repoSlug)...)
	}
	resp.Diagnostics.Append(resp.State.SetAttribute(ctx, path.Root("name"), entry.Name)...)
	resp.Diagnostics.Append(resp.State.SetAttribute(ctx, path.Root("environment"), entry.Environment)...)
	resp.Diagnostics.Append(resp.State.SetAttribute(ctx, path.Root("masked"), entry.Masked)...)
	resp.Diagnostics.Append(resp.State.SetAttribute(ctx, path.Root("secret_kind"), entry.SecretKind)...)
	if entry.Value != nil {
		resp.Diagnostics.Append(resp.State.SetAttribute(ctx, path.Root("value"), *entry.Value)...)
	}
}
