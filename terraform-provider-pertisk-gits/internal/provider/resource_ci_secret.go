package provider

import (
	"context"

	"github.com/hashicorp/terraform-plugin-framework/resource"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema"
	"github.com/hashicorp/terraform-plugin-framework/types"

	"github.com/pertisktech/pertisk-gits/terraform-provider-pertisk-gits/internal/client"
)

var (
	_ resource.Resource                = &ciSecretResource{}
	_ resource.ResourceWithConfigure   = &ciSecretResource{}
	_ resource.ResourceWithImportState = &ciSecretResource{}
)

func NewCiSecretResource() resource.Resource { return &ciSecretResource{} }

type ciSecretResource struct {
	api *client.Client
}

func (r *ciSecretResource) Metadata(_ context.Context, req resource.MetadataRequest, resp *resource.MetadataResponse) {
	resp.TypeName = req.ProviderTypeName + "_ci_secret"
}

func (r *ciSecretResource) Schema(_ context.Context, _ resource.SchemaRequest, resp *resource.SchemaResponse) {
	resp.Schema = schema.Schema{
		MarkdownDescription: "A CI secret (`secrets.NAME`) at server, group, or repository scope. Value is write-only.",
		Attributes:          ciSchema(true),
	}
}

func (r *ciSecretResource) Configure(_ context.Context, req resource.ConfigureRequest, resp *resource.ConfigureResponse) {
	r.api = configureClient(req.ProviderData, &resp.Diagnostics)
}

func (r *ciSecretResource) Create(ctx context.Context, req resource.CreateRequest, resp *resource.CreateResponse) {
	var plan ciEntryModel
	resp.Diagnostics.Append(req.Plan.Get(ctx, &plan)...)
	if resp.Diagnostics.HasError() {
		return
	}
	if err := validateCiScope(plan); err != nil {
		resp.Diagnostics.AddError("Invalid configuration", err.Error())
		return
	}

	scope := "secret"
	kind := plan.SecretKind.ValueString()
	if kind == "" {
		kind = "variable"
	}
	body := client.UpsertCiSecretRequest{
		Name:        plan.Name.ValueString(),
		ConfigScope: &scope,
		SecretKind:  &kind,
		Masked:      boolPtr(plan.Masked.ValueBool()),
		Environment: stringPtr(plan.Environment.ValueString()),
		Value:       plan.Value.ValueString(),
	}
	entry, err := r.api.CreateCiSecret(ctx, plan.Scope.ValueString(), orgPathValue(plan), repoSlugValue(plan), body)
	if err != nil {
		resp.Diagnostics.AddError("Create CI secret failed", err.Error())
		return
	}
	applyCiEntryState(&plan, entry, true)
	resp.Diagnostics.Append(resp.State.Set(ctx, &plan)...)
}

func (r *ciSecretResource) Read(ctx context.Context, req resource.ReadRequest, resp *resource.ReadResponse) {
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
		resp.Diagnostics.AddError("Read CI secret failed", err.Error())
		return
	}
	// Keep sensitive value from state; API does not return secret values.
	applyCiEntryState(&state, entry, true)
	resp.Diagnostics.Append(resp.State.Set(ctx, &state)...)
}

func (r *ciSecretResource) Update(ctx context.Context, req resource.UpdateRequest, resp *resource.UpdateResponse) {
	var plan ciEntryModel
	var state ciEntryModel
	resp.Diagnostics.Append(req.Plan.Get(ctx, &plan)...)
	resp.Diagnostics.Append(req.State.Get(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}
	scope := "secret"
	kind := plan.SecretKind.ValueString()
	if kind == "" {
		kind = "variable"
	}
	body := client.UpdateCiSecretRequest{
		ConfigScope: &scope,
		SecretKind:  &kind,
		Masked:      boolPtr(plan.Masked.ValueBool()),
		Value:       stringPtr(plan.Value.ValueString()),
	}
	entry, err := r.api.UpdateCiSecret(ctx, state.Scope.ValueString(), orgPathValue(state), repoSlugValue(state), state.ID.ValueString(), body)
	if err != nil {
		resp.Diagnostics.AddError("Update CI secret failed", err.Error())
		return
	}
	plan.Scope = state.Scope
	plan.OrgPath = state.OrgPath
	plan.RepoSlug = state.RepoSlug
	plan.Name = state.Name
	plan.Environment = state.Environment
	applyCiEntryState(&plan, entry, true)
	if plan.SecretKind.IsNull() || plan.SecretKind.IsUnknown() {
		plan.SecretKind = types.StringValue(kind)
	}
	resp.Diagnostics.Append(resp.State.Set(ctx, &plan)...)
}

func (r *ciSecretResource) Delete(ctx context.Context, req resource.DeleteRequest, resp *resource.DeleteResponse) {
	var state ciEntryModel
	resp.Diagnostics.Append(req.State.Get(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}
	if err := r.api.DeleteCiSecret(ctx, state.Scope.ValueString(), orgPathValue(state), repoSlugValue(state), state.ID.ValueString()); err != nil && !client.IsNotFound(err) {
		resp.Diagnostics.AddError("Delete CI secret failed", err.Error())
	}
}

func (r *ciSecretResource) ImportState(ctx context.Context, req resource.ImportStateRequest, resp *resource.ImportStateResponse) {
	importCiState(ctx, r.api, req.ID, "secret", resp)
}
