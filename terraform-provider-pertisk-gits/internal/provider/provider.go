package provider

import (
	"context"
	"os"
	"strings"

	"github.com/hashicorp/terraform-plugin-framework/datasource"
	"github.com/hashicorp/terraform-plugin-framework/path"
	"github.com/hashicorp/terraform-plugin-framework/provider"
	"github.com/hashicorp/terraform-plugin-framework/provider/schema"
	"github.com/hashicorp/terraform-plugin-framework/resource"
	"github.com/hashicorp/terraform-plugin-framework/types"

	"github.com/pertisktech/pertisk-gits/terraform-provider-pertisk-gits/internal/client"
)

var _ provider.Provider = &pertiskProvider{}

type pertiskProvider struct {
	version string
}

type providerModel struct {
	BaseURL  types.String `tfsdk:"base_url"`
	Token    types.String `tfsdk:"token"`
	Insecure types.Bool   `tfsdk:"insecure"`
}

func New(version string) func() provider.Provider {
	return func() provider.Provider {
		return &pertiskProvider{version: version}
	}
}

func (p *pertiskProvider) Metadata(_ context.Context, _ provider.MetadataRequest, resp *provider.MetadataResponse) {
	resp.TypeName = "pertisk_gits"
	resp.Version = p.version
}

func (p *pertiskProvider) Schema(_ context.Context, _ provider.SchemaRequest, resp *provider.SchemaResponse) {
	resp.Schema = schema.Schema{
		MarkdownDescription: "Manage Pertisk Gits groups, projects, and CI variables/secrets.",
		Attributes: map[string]schema.Attribute{
			"base_url": schema.StringAttribute{
				Optional:            true,
				MarkdownDescription: "Pertisk Gits base URL, e.g. `https://git.example.com`. Defaults to `PERTISK_GITS_URL` or `PERTISK_URL`.",
			},
			"token": schema.StringAttribute{
				Optional:            true,
				Sensitive:           true,
				MarkdownDescription: "API token or personal JWT. Defaults to `PERTISK_GITS_TOKEN` or `PERTISK_TOKEN`.",
			},
			"insecure": schema.BoolAttribute{
				Optional:            true,
				MarkdownDescription: "Skip TLS certificate verification. Defaults to `PERTISK_TLS_INSECURE`.",
			},
		},
	}
}

func (p *pertiskProvider) Configure(ctx context.Context, req provider.ConfigureRequest, resp *provider.ConfigureResponse) {
	var cfg providerModel
	resp.Diagnostics.Append(req.Config.Get(ctx, &cfg)...)
	if resp.Diagnostics.HasError() {
		return
	}

	baseURL := firstNonEmpty(cfg.BaseURL.ValueString(), os.Getenv("PERTISK_GITS_URL"), os.Getenv("PERTISK_URL"))
	token := firstNonEmpty(cfg.Token.ValueString(), os.Getenv("PERTISK_GITS_TOKEN"), os.Getenv("PERTISK_TOKEN"))
	insecure := boolFromEnv(os.Getenv("PERTISK_TLS_INSECURE"))
	if !cfg.Insecure.IsNull() {
		insecure = cfg.Insecure.ValueBool()
	}

	if baseURL == "" {
		resp.Diagnostics.AddAttributeError(
			path.Root("base_url"),
			"Missing Pertisk base URL",
			"Set provider base_url or PERTISK_GITS_URL / PERTISK_URL.",
		)
		return
	}
	if token == "" {
		resp.Diagnostics.AddAttributeError(
			path.Root("token"),
			"Missing Pertisk token",
			"Set provider token or PERTISK_GITS_TOKEN / PERTISK_TOKEN.",
		)
		return
	}

	api, err := client.New(client.Config{
		BaseURL:  baseURL,
		Token:    token,
		Insecure: insecure,
	})
	if err != nil {
		resp.Diagnostics.AddError("Unable to configure Pertisk Gits client", err.Error())
		return
	}
	resp.DataSourceData = api
	resp.ResourceData = api
}

func (p *pertiskProvider) Resources(_ context.Context) []func() resource.Resource {
	return []func() resource.Resource{
		NewGroupResource,
		NewProjectResource,
		NewCiVariableResource,
		NewCiSecretResource,
	}
}

func (p *pertiskProvider) DataSources(_ context.Context) []func() datasource.DataSource {
	return nil
}

func configureClient(providerData any, diags interface{ AddError(string, string) }) *client.Client {
	if providerData == nil {
		return nil
	}
	api, ok := providerData.(*client.Client)
	if !ok {
		diags.AddError("Unexpected provider data", "The Pertisk Gits provider received the wrong client type.")
		return nil
	}
	return api
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return strings.TrimSpace(v)
		}
	}
	return ""
}

func boolFromEnv(v string) bool {
	switch strings.ToLower(strings.TrimSpace(v)) {
	case "1", "true", "yes", "on":
		return true
	default:
		return false
	}
}

func stringPtr(v string) *string { return &v }
func boolPtr(v bool) *bool       { return &v }
